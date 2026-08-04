import { createClient } from '@/lib/supabase/server'
import { claimDueReminders } from '@/lib/db/reminders'

// Polled client-side while the app is open in a browser tab (see
// reminder-poller.tsx). This is a deliberate, honest subset of the Electron
// app's always-on-process + native-OS-notification behavior: it can only
// notify while a tab is open, never when the browser itself is closed. Real
// closed-browser delivery would need Web Push (service worker + VAPID keys)
// or a server-side cron+email path — both deferred until actually needed.
export async function POST(): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const fired = await claimDueReminders(supabase)
  return Response.json({ reminders: fired })
}
