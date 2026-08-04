import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createMemory } from '@/lib/db/memories'
import { createReminder, listPendingReminders } from '@/lib/db/reminders'
import { getWeather } from '@/lib/weather/weather'
import { searchWeb } from '@/lib/search/duckduckgo'

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

    default:
      return `Error: unknown tool "${request.name}".`
  }
}
