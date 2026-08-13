import { createClient } from '@/lib/supabase/server'
import { claimDueReminders } from '@/lib/db/reminders'
import { describeSupabaseError } from '@/lib/supabase/describe-error'

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

  try {
    const fired = await claimDueReminders(supabase)
    return Response.json({ reminders: fired })
  } catch (error) {
    // claimDueReminders throws on any database error, and this route runs
    // every 30 seconds for as long as a tab is open. Left unhandled, one
    // transient fault became an unhandled 500 twice a minute, logged as a
    // bare `{}` because PostgrestError does not serialise — 307 of them
    // accumulated before anyone noticed the poller had been failing at all.
    console.error('Reminder poll failed:', describeSupabaseError(error))

    // 200 with nothing due, not a 500. Failing to find a due reminder is
    // invisible to the user either way, and a 5xx here would only add noise
    // to the client that cannot act on it. The log is where this belongs.
    return Response.json({ reminders: [] })
  }
}
