import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createMemory } from '@/lib/db/memories'
import { createReminder, listPendingReminders } from '@/lib/db/reminders'
import { getWeather } from '@/lib/weather/weather'
import { searchWeb } from '@/lib/search/tavily'
import { createCalendarEvent, getValidAccessToken, listUpcomingEvents } from '@/lib/google/calendar'

const CALENDAR_NOT_CONNECTED =
  'Google Calendar is not connected. Tell the user to connect it on the Calendar page.'

type Client = SupabaseClient<Database>

export interface ToolCallRequest {
  name: string
  argumentsJson: string
}

/**
 * Executes one tool call and returns the plain-text result to feed back to
 * the model as the tool response message. Never throws — invalid input, a
 * network/API failure (get_weather), or an unknown tool name all become an
 * error string the model can react to instead of failing the request.
 */
export async function executeToolCall(
  request: ToolCallRequest,
  supabase: Client,
  userId: string
): Promise<string> {
  let args: Record<string, unknown>

  try {
    args = request.argumentsJson ? JSON.parse(request.argumentsJson) : {}
  } catch {
    return `Error: could not parse arguments for "${request.name}" as JSON.`
  }

  switch (request.name) {
    case 'create_reminder': {
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      const scheduledAtIso = typeof args.scheduled_at_iso === 'string' ? args.scheduled_at_iso : ''

      if (!content) return 'Error: content is required.'

      const scheduledAt = Date.parse(scheduledAtIso)
      if (Number.isNaN(scheduledAt)) {
        return `Error: could not parse "${scheduledAtIso}" as a date.`
      }

      await createReminder(supabase, {
        userId,
        content,
        scheduledAt: new Date(scheduledAt).toISOString()
      })
      return `Reminder saved: "${content}" at ${new Date(scheduledAt).toLocaleString()}.`
    }

    case 'create_memory': {
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      if (!content) return 'Error: content is required.'

      await createMemory(supabase, { userId, content })
      return `Memory saved: "${content}".`
    }

    case 'list_reminders': {
      const pending = await listPendingReminders(supabase)
      if (pending.length === 0) return 'No upcoming reminders.'

      return pending
        .map((r) => `- "${r.content}" at ${new Date(r.scheduled_at).toLocaleString()}`)
        .join('\n')
    }

    case 'get_weather': {
      const location = typeof args.location === 'string' ? args.location.trim() : ''
      if (!location) return 'Error: location is required.'

      try {
        return await getWeather(location)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error fetching weather: ${message}`
      }
    }

    case 'search_web': {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return 'Error: query is required.'

      try {
        return await searchWeb(query)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error searching: ${message}`
      }
    }

    case 'list_calendar_events': {
      try {
        const accessToken = await getValidAccessToken(supabase)
        if (!accessToken) return CALENDAR_NOT_CONNECTED

        const events = await listUpcomingEvents(accessToken)
        if (events.length === 0) return 'No upcoming calendar events.'

        return events
          .map((e) => `- "${e.summary}" at ${new Date(e.start).toLocaleString()}`)
          .join('\n')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error fetching calendar events: ${message}`
      }
    }

    case 'create_calendar_event': {
      const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
      const startIso = typeof args.start_iso === 'string' ? args.start_iso : ''
      const endIso = typeof args.end_iso === 'string' ? args.end_iso : ''
      const description = typeof args.description === 'string' ? args.description : undefined

      if (!summary) return 'Error: summary is required.'
      if (Number.isNaN(Date.parse(startIso))) return `Error: could not parse "${startIso}" as a date.`
      if (Number.isNaN(Date.parse(endIso))) return `Error: could not parse "${endIso}" as a date.`

      try {
        const accessToken = await getValidAccessToken(supabase)
        if (!accessToken) return CALENDAR_NOT_CONNECTED

        const event = await createCalendarEvent(accessToken, { summary, startIso, endIso, description })
        return `Calendar event created: "${event.summary}" at ${new Date(event.start).toLocaleString()}.`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error creating calendar event: ${message}`
      }
    }

    default:
      return `Error: unknown tool "${request.name}".`
  }
}
