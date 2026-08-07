import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Called by push-subscribe.tsx once the browser has a live PushSubscription.
// Upserts on endpoint (unique) rather than always inserting — the same
// browser/device re-subscribing (e.g. after clearing site data) should
// replace its old row, not accumulate duplicates that would each get a
// separate (and for the stale one, failing) push on every digest send.
export async function POST(request: NextRequest): Promise<Response> {
  const { endpoint, keys } = (await request.json()) as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return new Response('Missing endpoint or keys', { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: 'endpoint' }
    )

  if (error) return new Response(error.message, { status: 500 })
  return new Response(null, { status: 204 })
}
