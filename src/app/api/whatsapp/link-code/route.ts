import { createClient } from '@/lib/supabase/server'
import { createLinkCode } from '@/lib/whatsapp/linking'
import { isWhatsAppConfigured } from '@/lib/whatsapp/client'
import { getChatRatelimit } from '@/lib/redis/ratelimit'

// Issues a short-lived code the user sends from WhatsApp to prove that the
// number and the account belong to the same person.
//
// Deliberately uses the RLS-scoped session client, not the admin client:
// the code must be bound to whoever is actually signed in, and letting a
// caller name the user would make the whole linking step meaningless.

export async function POST(): Promise<Response> {
  if (!isWhatsAppConfigured()) {
    return new Response('WhatsApp is not available yet', { status: 503 })
  }

  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  // Codes are cheap to make but each one is a live credential until it
  // expires; the shared chat limiter is enough to stop someone minting
  // thousands.
  const limit = await getChatRatelimit().limit(user.id)
  if (!limit.success) {
    return new Response('Too many requests — try again shortly.', { status: 429 })
  }

  try {
    const code = await createLinkCode(supabase, user.id)
    return Response.json({ code })
  } catch (error) {
    console.error('Could not create WhatsApp link code:', error)
    return new Response('Could not create a code', { status: 500 })
  }
}
