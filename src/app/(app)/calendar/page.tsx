import { Calendar as CalendarIcon, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCalendarConnection } from '@/lib/db/calendar'
import { getValidAccessToken, listUpcomingEvents } from '@/lib/google/calendar'
import { PageHeader } from '../page-header'
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
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader
        icon={CalendarIcon}
        title="Calendar"
        description="Connect Google Calendar so Sofii can check and create events for you in chat."
      />

      {connected && (
        <p className="mb-4 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-400">
          Google Calendar connected.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-[var(--danger)]">
          {ERROR_MESSAGES[error] ?? 'Something went wrong.'}
        </p>
      )}

      {connection ? (
        <div>
          <div className="mb-6 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
            <span className="flex items-center gap-1.5 text-sm text-[var(--text)]">
              <CheckCircle2 size={15} className="text-emerald-400" />
              Connected to Google Calendar
            </span>
            <DisconnectButton />
          </div>

          <h2 className="mb-3 text-sm font-medium text-[var(--text-muted)]">Upcoming events</h2>
          {eventsError && (
            <p className="text-sm text-[var(--danger)]">Could not load events: {eventsError}</p>
          )}
          {!eventsError && events.length === 0 && (
            <p className="text-[var(--text-muted)]">No upcoming events.</p>
          )}
          <div className="space-y-2">
            {events.map((event) => (
              <div
                key={event.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
              >
                <div>{event.summary}</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {new Date(event.start).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <a
          href="/api/auth/google/connect"
          className="inline-block rounded-lg px-5 py-3 font-medium text-[var(--accent-gradient-text)]"
          style={{ background: 'var(--accent-gradient)' }}
        >
          Connect Google Calendar
        </a>
      )}
    </div>
  )
}
