import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  getCalendarConnection,
  getCalendarConnectionForUser,
  updateCalendarAccessToken,
  updateCalendarAccessTokenForUser
} from '@/lib/db/calendar'
import { refreshAccessToken } from '@/lib/google/oauth'

type Client = SupabaseClient<Database>

// Refresh a bit before actual expiry so a slow request doesn't race past it.
const EXPIRY_SAFETY_MARGIN_MS = 60_000

/**
 * Returns a valid access token for the user's connected Google Calendar,
 * transparently refreshing (and persisting the refreshed token) if the
 * stored one is expired or close to it. Returns null if not connected —
 * callers turn that into a clear "not connected" tool result rather than an
 * error.
 */
export async function getValidAccessToken(supabase: Client): Promise<string | null> {
  const connection = await getCalendarConnection(supabase)
  if (!connection) return null

  const expiresAt = new Date(connection.expires_at).getTime()
  if (expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return connection.access_token
  }

  const refreshed = await refreshAccessToken(connection.refresh_token)
  await updateCalendarAccessToken(supabase, {
    accessToken: refreshed.access_token,
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  })
  return refreshed.access_token
}

// Cron-safe counterpart to getValidAccessToken above — see
// getCalendarConnectionForUser's doc comment for why this needs its own
// explicitly user_id-scoped path rather than reusing the RLS-implicit one.
export async function getValidAccessTokenForUser(
  supabase: Client,
  userId: string
): Promise<string | null> {
  const connection = await getCalendarConnectionForUser(supabase, userId)
  if (!connection) return null

  const expiresAt = new Date(connection.expires_at).getTime()
  if (expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return connection.access_token
  }

  const refreshed = await refreshAccessToken(connection.refresh_token)
  await updateCalendarAccessTokenForUser(supabase, userId, {
    accessToken: refreshed.access_token,
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  })
  return refreshed.access_token
}

export interface CalendarEvent {
  id: string
  summary: string
  start: string
  end: string
}

interface GoogleCalendarEventResponse {
  id: string
  summary?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
}

function toCalendarEvent(event: GoogleCalendarEventResponse): CalendarEvent {
  return {
    id: event.id,
    summary: event.summary ?? '(no title)',
    start: event.start.dateTime ?? event.start.date ?? '',
    end: event.end.dateTime ?? event.end.date ?? ''
  }
}

export async function listUpcomingEvents(
  accessToken: string,
  maxResults = 10
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    maxResults: String(maxResults),
    singleEvents: 'true',
    orderBy: 'startTime'
  })

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!response.ok) {
    throw new Error(`Google Calendar list events failed with status ${response.status}`)
  }

  const data = (await response.json()) as { items: GoogleCalendarEventResponse[] }
  return data.items.map(toCalendarEvent)
}

export async function createCalendarEvent(
  accessToken: string,
  params: { summary: string; startIso: string; endIso: string; description?: string }
): Promise<CalendarEvent> {
  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: params.summary,
        description: params.description,
        start: { dateTime: params.startIso },
        end: { dateTime: params.endIso }
      })
    }
  )

  if (!response.ok) {
    throw new Error(
      `Google Calendar create event failed with status ${response.status}: ${await response.text()}`
    )
  }

  return toCalendarEvent(await response.json())
}
