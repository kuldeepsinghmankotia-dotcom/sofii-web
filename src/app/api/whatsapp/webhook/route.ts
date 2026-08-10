import { NextRequest, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWhatsAppConfig, markWhatsAppRead, sendWhatsAppText, type WhatsAppConfig } from '@/lib/whatsapp/client'
import { resolveVerificationChallenge, verifyWebhookSignature } from '@/lib/whatsapp/signature'
import { extractMessages, type WhatsAppMessage, type WhatsAppWebhookPayload } from '@/lib/whatsapp/types'
import {
  claimMessage,
  findLinkedAccount,
  parseLinkCommand,
  redeemLinkCode,
  setLinkedConversation
} from '@/lib/whatsapp/linking'
import { generateReply } from '@/lib/chat/generate-reply'
import { getWhatsAppRatelimit } from '@/lib/redis/ratelimit'

// The WhatsApp Cloud API webhook.
//
// Two jobs: answer Meta's one-time verification handshake (GET), and accept
// delivered messages (POST).
//
// The POST path returns 200 before the reply is generated. Meta expects a
// prompt response and redelivers anything slow, so doing the model work
// inline would turn every reply into a duplicate — and generating a reply
// takes seconds, not milliseconds. after() runs the real work once the
// response is already on its way back.

export async function GET(request: NextRequest): Promise<Response> {
  const config = getWhatsAppConfig()
  if (!config) return new Response('Not configured', { status: 404 })

  const challenge = resolveVerificationChallenge(request.nextUrl.searchParams, config.verifyToken)
  if (!challenge) return new Response('Forbidden', { status: 403 })

  // Meta requires the challenge echoed back verbatim as plain text.
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

export async function POST(request: NextRequest): Promise<Response> {
  const config = getWhatsAppConfig()
  if (!config) return new Response('Not configured', { status: 404 })

  // Read as text, never json(). The signature covers the exact bytes Meta
  // sent, and parsing then re-serialising changes key order and whitespace,
  // which changes the hash.
  const rawBody = await request.text()

  if (!verifyWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'), config.appSecret)) {
    console.error('WhatsApp webhook signature verification failed')
    // 403, not 401: this is not an authentication challenge the caller can
    // retry differently, and a 5xx would make Meta redeliver forever.
    return new Response('Invalid signature', { status: 403 })
  }

  let payload: WhatsAppWebhookPayload
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload
  } catch {
    // Signed but unparseable. 200 so Meta stops resending something that
    // will never parse.
    return new Response('OK', { status: 200 })
  }

  const incoming = extractMessages(payload)

  // Delivery receipts arrive constantly and carry no messages.
  if (incoming.length > 0) {
    after(async () => {
      for (const { message, profileName } of incoming) {
        try {
          await handleMessage(config, message, profileName)
        } catch (error) {
          // One bad message must not abandon the rest of the batch.
          console.error('WhatsApp message handling failed:', message.id, error)
        }
      }
    })
  }

  return new Response('OK', { status: 200 })
}

const UNLINKED_REPLY = `Hi! I'm Sofii. This number isn't connected to an account yet.

Open sofii-web.vercel.app, sign in, go to Settings → WhatsApp, and send me the 6-character code it shows you.`

const LINK_FAILED: Record<string, string> = {
  invalid: "That code doesn't look right. Grab a fresh one from Settings → WhatsApp in the app.",
  expired: 'That code has expired — they only last 15 minutes. Generate a new one and send it over.',
  'already-used': 'That code has already been used. Generate a new one from Settings → WhatsApp.'
}

async function handleMessage(
  config: WhatsAppConfig,
  message: WhatsAppMessage,
  profileName: string | null
): Promise<void> {
  const supabase = createAdminClient()

  // Idempotency before anything with a side effect. Meta redelivers, and
  // answering twice both confuses the user and doubles the model spend.
  if (!(await claimMessage(supabase, message.id))) return

  await markWhatsAppRead(config, message.id)

  const phone = message.from
  const link = await findLinkedAccount(supabase, phone)

  const text = message.type === 'text' ? (message as { text: { body: string } }).text.body : null

  // Linking is handled before the account lookup, since by definition an
  // unlinked number is the one that needs it.
  if (text) {
    const code = parseLinkCommand(text)
    if (code && !link) {
      const result = await redeemLinkCode(supabase, code, phone, profileName)
      await sendWhatsAppText(
        config,
        phone,
        result.status === 'linked'
          ? `Done — this number is linked${profileName ? `, ${profileName}` : ''}. Ask me anything, and I'll remember it.`
          : (LINK_FAILED[result.status] ?? LINK_FAILED.invalid)
      )
      return
    }
  }

  if (!link) {
    await sendWhatsAppText(config, phone, UNLINKED_REPLY)
    return
  }

  // Rate limited per account, not per number: the cost being protected is
  // model spend, which belongs to the account.
  const limit = await getWhatsAppRatelimit().limit(link.userId)
  if (!limit.success) {
    await sendWhatsAppText(config, phone, "You're going a bit fast for me — give me a minute and try again.")
    return
  }

  if (!text) {
    // Voice notes, images and documents are handled in a later pass; saying
    // so is better than silence, which reads as being ignored.
    await sendWhatsAppText(
      config,
      phone,
      "I can only read text messages here for now — voice notes and files are coming. Type it out and I'll help."
    )
    return
  }

  const conversationId = await ensureConversation(supabase, link.userId, link.conversationId, phone)
  if (!conversationId) {
    await sendWhatsAppText(config, phone, 'Something went wrong on my side. Try again in a moment.')
    return
  }

  const reply = await generateReply({
    supabase,
    userId: link.userId,
    conversationId,
    userText: text
  })

  await sendWhatsAppText(
    config,
    phone,
    reply ?? "I didn't quite catch that — could you rephrase?"
  )
}

/**
 * The conversation this number's messages belong to.
 *
 * WhatsApp has no threads, so a number maps to one rolling conversation —
 * that continuity is what lets Sofii remember what was said an hour ago
 * instead of starting fresh on every message.
 */
async function ensureConversation(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  existingId: string | null,
  phone: string
): Promise<string | null> {
  if (existingId) {
    // Confirm it still exists — the user can delete conversations from the
    // web app, which would leave a dangling id here.
    const { data } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', existingId)
      .eq('user_id', userId)
      .maybeSingle()

    if (data) return data.id
  }

  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, title: 'WhatsApp' })
    .select('id')
    .single()

  if (error || !data) {
    console.error('Could not create WhatsApp conversation:', error)
    return null
  }

  await setLinkedConversation(supabase, phone, data.id)
  return data.id
}
