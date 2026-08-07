import webpush, { WebPushError } from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

let configured = false

function ensureConfigured(): void {
  if (configured) return
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
  configured = true
}

export interface PushPayload {
  title: string
  body: string
  url?: string
}

/**
 * Sends one push to every subscription the user has (multiple
 * devices/browsers each get their own row — see push_subscriptions).
 * A 404/410 from the push service means that subscription is gone for good
 * (browser uninstalled, permission revoked, etc.) — those rows are deleted
 * rather than retried, since they'll never succeed again. Any other error
 * (network blip, transient 5xx) is logged and left alone for the next
 * digest run to retry naturally.
 */
export async function sendPushToUser(
  supabase: Client,
  userId: string,
  payload: PushPayload
): Promise<void> {
  ensureConfigured()

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (error) throw error
  if (!subscriptions || subscriptions.length === 0) return

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        )
      } catch (err) {
        if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          console.error('Push send error:', err)
        }
      }
    })
  )
}
