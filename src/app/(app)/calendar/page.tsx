import { createClient } from '@/lib/supabase/server'
import { getCalendarConnection } from '@/lib/db/calendar'
import { getValidAccessToken, listUpcomingEvents } from '@/lib/google/calendar'
import DisconnectButton from './disconnect-button'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: 'Something went wrong verifying the connection request. Please try again.',
  no_refresh_token: 'Google did not grant offline access. Please try connecting again.',
  exchange_failed: 'Could not complete the connection to Google. Please try again.'
}

export default async function CalendarPage({
  searchParams
}: {
  searchParams: Promise<{ connected?: string; error?: string }>
}) {
  const { connected, error } = await searchParams
  const supabase = await createClient()
  const connection = await getCalendarConnection(supabase)

  let events: Awaited<ReturnType<typeof listUpcomingEvents>> = []
  let eventsError: string | null = null
  if (connection) {
    try {
      const accessToken = await getValidAccessToken(supabase)
      if (accessToken) events = await listUpcomingEvents(accessToken)
    } catch (err) {
      eventsError = err instanceof Error ? err.message : String(err)
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-xl font-bold">📅 Calendar</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Connect Google Calendar so Sofii can check and create events for you in chat.
      </p>

      {connected && (
        <p className="mb-4 rounded-lg bg-green-900/40 p-3 text-sm text-green-400">
          Google Calendar connected.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-lg bg-red-900/40 p-3 text-sm text-red-400">
          {ERROR_MESSAGES[error] ?? 'Something went wrong.'}
        </p>
      )}

      {connection ? (
        <div>
          <div className="mb-6 flex items-center justify-between rounded-lg bg-neutral-900 p-4">
            <span className="text-sm text-neutral-300">✓ Connected to Google Calendar</span>
            <DisconnectButton />
          </div>

          <h2 className="mb-3 text-sm font-medium text-neutral-400">Upcoming events</h2>
          {eventsError && <p className="text-sm text-red-400">Could not load events: {eventsError}</p>}
          {!eventsError && events.length === 0 && (
            <p className="text-neutral-400">No upcoming events.</p>
          )}
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="rounded-lg bg-neutral-900 p-3">
                <div>{event.summary}</div>
                <div className="text-xs text-neutral-400">{new Date(event.start).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <a
          href="/api/auth/google/connect"
          className="inline-block rounded-lg bg-blue-600 px-5 py-3 font-medium"
        >
          Connect Google Calendar
        </a>
      )}
    </div>
  )
}
