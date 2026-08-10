import { NextRequest, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getChatRatelimit } from '@/lib/redis/ratelimit'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push/send'

const MAX_MESSAGE_CHARS = 4000
const KINDS = ['suggestion', 'bug', 'help'] as const
type Kind = (typeof KINDS)[number]

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  // Reuses the chat limiter rather than adding a fourth bucket: this
  // endpoint writes a row and spends nothing else, so it only needs
  // abuse protection, not its own budget.
  const rateLimit = await getChatRatelimit().limit(user.id)
  if (!rateLimit.success) {
    return new Response("You're sending feedback too quickly — please try again shortly.", {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000))) }
    })
  }

  const body = (await request.json().catch(() => ({}))) as {
    kind?: string
    message?: string
    pagePath?: string
  }

  const message = body.message?.trim()
  if (!message) return new Response('Missing message', { status: 400 })

  const kind: Kind = KINDS.includes(body.kind as Kind) ? (body.kind as Kind) : 'suggestion'

  const { error } = await supabase.from('feedback').insert({
    user_id: user.id,
    kind,
    message: message.slice(0, MAX_MESSAGE_CHARS),
    page_path: body.pagePath?.slice(0, 300) ?? null,
    // Read server-side rather than trusting a client-supplied value —
    // a bug report's value depends on this being accurate.
    user_agent: request.headers.get('user-agent')?.slice(0, 400) ?? null
  })

  if (error) {
    console.error('Feedback insert error:', error)
    return new Response('Could not save feedback', { status: 500 })
  }

  // Notify admins immediately rather than waiting for them to think to
  // open the inbox. Scheduled via after() so a slow push service never
  // delays the user's "thanks, sent" — and never fails their submission,
  // which is already safely stored by this point.
  after(() => notifyAdminsOfFeedback(kind, message))

  return new Response(null, { status: 204 })
}

const KIND_TITLES: Record<Kind, string> = {
  suggestion: 'New idea from a user',
  bug: 'New bug report',
  help: 'Someone needs help'
}

/**
 * Best-effort admin notification. Uses the service-role client because it
 * has to read *other* users' profiles and push subscriptions to find the
 * admins — the requesting user's RLS-scoped client can see neither, and
 * this runs after the response on the server, not on the user's behalf.
 */
async function notifyAdminsOfFeedback(kind: Kind, message: string): Promise<void> {
  try {
    const admin = createAdminClient()

    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin')
    if (!admins || admins.length === 0) return

    await Promise.all(
      admins.map((row) =>
        sendPushToUser(admin, row.id, {
          title: KIND_TITLES[kind],
          // Truncated: a push notification body is clipped by the OS
          // anyway, and the full text is one tap away in the inbox.
          body: message.length > 120 ? `${message.slice(0, 120)}…` : message,
          url: '/admin/feedback'
        })
      )
    )
  } catch (err) {
    // A failed notification must never look like a failed submission —
    // the feedback row is already committed.
    console.error('Admin feedback notification error:', err)
  }
}
