import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createMemory, deleteMemory, listMemories, updateMemory } from '@/lib/db/memories'
import {
  cancelReminder,
  createReminder,
  listPendingReminders,
  rescheduleReminder
} from '@/lib/db/reminders'
import { getWeather } from '@/lib/weather/weather'
import { searchWeb } from '@/lib/search/tavily'
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getValidAccessToken,
  listUpcomingEvents,
  updateCalendarEvent
} from '@/lib/google/calendar'
import { recallRelatedMessagesByText } from '@/lib/db/message-embeddings'
import { calculate } from './calculate'
import { readWebpage } from './read-webpage'
import { saveNoteAsDocument, searchEverything } from './knowledge'

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
  userId: string,
  // Which conversation this call is happening in — used by
  // recall_past_conversations to exclude the current thread from its own
  // search results (its history is already fully in context). Optional so
  // non-chat callers don't have to invent one.
  context?: { conversationId?: string }
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

      // ids are included because cancel_reminder/reschedule_reminder need
      // them and must never guess one.
      return pending
        .map((r) => `- [id: ${r.id}] "${r.content}" at ${new Date(r.scheduled_at).toLocaleString()}`)
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

        // ids are included because update_calendar_event and
        // delete_calendar_event need them and must never guess one.
        return events
          .map((e) => `- [id: ${e.id}] "${e.summary}" at ${new Date(e.start).toLocaleString()}`)
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

    case 'cancel_reminder': {
      const reminderId = typeof args.reminder_id === 'string' ? args.reminder_id.trim() : ''
      if (!reminderId) return 'Error: reminder_id is required.'

      try {
        await cancelReminder(supabase, reminderId)
        return 'Reminder cancelled.'
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error cancelling reminder: ${message}`
      }
    }

    case 'reschedule_reminder': {
      const reminderId = typeof args.reminder_id === 'string' ? args.reminder_id.trim() : ''
      const scheduledAtIso = typeof args.scheduled_at_iso === 'string' ? args.scheduled_at_iso : ''
      if (!reminderId) return 'Error: reminder_id is required.'

      const scheduledAt = Date.parse(scheduledAtIso)
      if (Number.isNaN(scheduledAt)) return `Error: could not parse "${scheduledAtIso}" as a date.`

      try {
        const updated = await rescheduleReminder(
          supabase,
          reminderId,
          new Date(scheduledAt).toISOString()
        )
        if (!updated) {
          return 'That reminder could not be rescheduled — it may have already fired or been cancelled. Suggest creating a new one instead.'
        }
        return `Reminder moved to ${new Date(updated.scheduled_at).toLocaleString()}.`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error rescheduling reminder: ${message}`
      }
    }

    case 'list_memories': {
      const memories = await listMemories(supabase)
      if (memories.length === 0) return 'No stored memories yet.'

      return memories.map((m) => `- [id: ${m.id}] ${m.content}`).join('\n')
    }

    case 'update_memory': {
      const memoryId = typeof args.memory_id === 'string' ? args.memory_id.trim() : ''
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      if (!memoryId) return 'Error: memory_id is required.'
      if (!content) return 'Error: content is required.'

      try {
        await updateMemory(supabase, memoryId, content)
        return `Memory updated to: "${content}".`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error updating memory: ${message}`
      }
    }

    case 'forget_memory': {
      const memoryId = typeof args.memory_id === 'string' ? args.memory_id.trim() : ''
      if (!memoryId) return 'Error: memory_id is required.'

      try {
        await deleteMemory(supabase, memoryId)
        return 'Memory forgotten.'
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error forgetting memory: ${message}`
      }
    }

    case 'read_webpage': {
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      if (!url) return 'Error: url is required.'

      try {
        const page = await readWebpage(url)
        const header = page.title ? `Title: ${page.title}\nURL: ${page.url}` : `URL: ${page.url}`
        const footer = page.truncated ? '\n\n[Page truncated — this is the beginning only.]' : ''
        return `${header}\n\n${page.text}${footer}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Could not read that page: ${message}. Tell the user honestly rather than inventing its contents.`
      }
    }

    case 'calculate': {
      const expression = typeof args.expression === 'string' ? args.expression.trim() : ''
      if (!expression) return 'Error: expression is required.'

      try {
        return `${expression} = ${calculate(expression)}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Could not evaluate "${expression}": ${message}`
      }
    }

    case 'save_note': {
      const title = typeof args.title === 'string' ? args.title.trim() : ''
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      if (!title) return 'Error: title is required.'
      if (!content) return 'Error: content is required.'

      try {
        const saved = await saveNoteAsDocument(supabase, userId, title, content)
        return `Saved as "${saved.filename}" in the user's documents (${saved.chunkCount} section${saved.chunkCount === 1 ? '' : 's'}). It's searchable from any future conversation.`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error saving note: ${message}`
      }
    }

    case 'search_everything': {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return 'Error: query is required.'

      return searchEverything(
        supabase,
        query,
        // Same nil-UUID sentinel as recall_past_conversations — see that
        // case for why a real UUID shape is required here.
        context?.conversationId ?? '00000000-0000-0000-0000-000000000000'
      )
    }

    case 'update_calendar_event': {
      const eventId = typeof args.event_id === 'string' ? args.event_id.trim() : ''
      if (!eventId) return 'Error: event_id is required.'

      const startIso = typeof args.start_iso === 'string' ? args.start_iso : undefined
      const endIso = typeof args.end_iso === 'string' ? args.end_iso : undefined
      if (startIso && Number.isNaN(Date.parse(startIso))) {
        return `Error: could not parse "${startIso}" as a date.`
      }
      if (endIso && Number.isNaN(Date.parse(endIso))) {
        return `Error: could not parse "${endIso}" as a date.`
      }

      try {
        const accessToken = await getValidAccessToken(supabase)
        if (!accessToken) return CALENDAR_NOT_CONNECTED

        const event = await updateCalendarEvent(accessToken, eventId, {
          summary: typeof args.summary === 'string' ? args.summary : undefined,
          description: typeof args.description === 'string' ? args.description : undefined,
          startIso,
          endIso
        })
        return `Calendar event updated: "${event.summary}" at ${new Date(event.start).toLocaleString()}.`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error updating calendar event: ${message}`
      }
    }

    case 'delete_calendar_event': {
      const eventId = typeof args.event_id === 'string' ? args.event_id.trim() : ''
      if (!eventId) return 'Error: event_id is required.'

      try {
        const accessToken = await getValidAccessToken(supabase)
        if (!accessToken) return CALENDAR_NOT_CONNECTED

        await deleteCalendarEvent(accessToken, eventId)
        return 'Calendar event deleted.'
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error deleting calendar event: ${message}`
      }
    }

    case 'recall_past_conversations': {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return 'Error: query is required.'

      const results = await recallRelatedMessagesByText(
        supabase,
        query,
        // Empty-string sentinel rather than skipping the filter: the RPC
        // compares with IS DISTINCT FROM, so a null would match nothing to
        // exclude, which is exactly the right behavior when there's no
        // current conversation to exclude. A non-uuid string would error,
        // so fall back to a nil UUID (never a real conversation id).
        context?.conversationId ?? '00000000-0000-0000-0000-000000000000',
        5
      )

      if (results.length === 0) {
        return 'No relevant past conversations found. Tell the user you could not find anything about that in your earlier conversations, rather than guessing.'
      }

      return results
        .map((m) => {
          const when = new Date(m.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          })
          const speaker = m.role === 'user' ? 'User' : 'You'
          return `[${when}, conversation "${m.conversation_title}"] ${speaker}: ${m.content.slice(0, 800)}`
        })
        .join('\n\n')
    }

    default:
      return `Error: unknown tool "${request.name}".`
  }
}
