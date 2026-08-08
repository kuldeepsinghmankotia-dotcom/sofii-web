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

// Shared by summarize_document/compare_documents/extract_structured_data:
// calls the Python query-agent's /query endpoint directly, server-to-
// server, with an explicit intent so it skips its own LLM classification
// step (the caller here already knows exactly which flow it wants). Same
// service the standalone Ask Documents UI proxies through via /api/query,
// just invoked without that route's thread-history bookkeeping — a tool
// call inside main chat already has the whole conversation as context.
async function callQueryAgent(payload: {
  query: string
  userId: string
  documentIds: string[]
  intent: 'summarize_document' | 'compare_documents' | 'extract_structured_data'
}): Promise<string> {
  const serviceUrl = process.env.INGEST_SERVICE_URL
  const serviceSecret = process.env.INGEST_SERVICE_SECRET

  if (!serviceUrl || !serviceSecret) {
    return 'Error: document tools are not configured.'
  }

  let response: Response
  try {
    response = await fetch(`${serviceUrl}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: payload.query,
        user_id: payload.userId,
        document_ids: payload.documentIds,
        intent: payload.intent
      }),
      signal: AbortSignal.timeout(45_000)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error: document tools are temporarily offline (${message}). Tell the user to try again shortly.`
  }

  if (!response.ok) {
    if (response.status === 502 || response.status === 503) {
      return 'Error: document tools are temporarily offline. Tell the user to try again shortly.'
    }
    return `Error: document tool request failed (status ${response.status}).`
  }

  const data = (await response.json()) as { answer?: string }
  return data.answer?.trim() || 'No answer returned.'
}

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

    case 'summarize_document': {
      const documentId = typeof args.document_id === 'string' ? args.document_id.trim() : ''
      if (!documentId) return 'Error: document_id is required.'

      return callQueryAgent({
        query: 'Summarize this document.',
        userId,
        documentIds: [documentId],
        intent: 'summarize_document'
      })
    }

    case 'compare_documents': {
      const documentIds = Array.isArray(args.document_ids)
        ? args.document_ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : []
      if (documentIds.length < 2) return 'Error: at least two document_ids are required.'

      return callQueryAgent({
        query: 'Compare these documents.',
        userId,
        documentIds,
        intent: 'compare_documents'
      })
    }

    case 'extract_structured_data': {
      const documentId = typeof args.document_id === 'string' ? args.document_id.trim() : ''
      const extractionRequest = typeof args.request === 'string' ? args.request.trim() : ''
      if (!documentId) return 'Error: document_id is required.'
      if (!extractionRequest) return 'Error: request is required.'

      return callQueryAgent({
        query: extractionRequest,
        userId,
        documentIds: [documentId],
        intent: 'extract_structured_data'
      })
    }

    default:
      return `Error: unknown tool "${request.name}".`
  }
}
