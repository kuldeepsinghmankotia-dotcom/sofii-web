import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'

export const TOOL_DEFINITIONS: ChatCompletionFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_reminder',
      description:
        'Create a reminder for the user at a specific date and time. Use this whenever the user asks to be reminded, notified, or nudged about something at a future time. Note: this shows a browser notification when it comes due only while Sofii is open in a tab — it cannot notify if the browser itself is fully closed.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'What to remind the user about.' },
          scheduled_at_iso: {
            type: 'string',
            description:
              'ISO 8601 datetime (with timezone offset) when the reminder should fire. Resolve relative times like "in 10 minutes" or "tomorrow at 5pm" using the current date/time given in the system prompt.'
          }
        },
        required: ['content', 'scheduled_at_iso']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_memory',
      description:
        'Save a durable fact about the user for recall in future conversations. Use this only when the user explicitly asks you to remember something.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The fact to remember, written as a short standalone statement.'
          }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description:
        "List the user's upcoming (pending) reminders. Use this when the user asks what reminders they have or what's coming up.",
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description:
        "Get the current weather and a 3-day forecast for a location. Use this whenever the user asks about weather, temperature, or whether it will rain/snow somewhere. If you don't know the user's location, ask them or check if they've told you before.",
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'A city name (and optionally country), e.g. "Delhi" or "Paris, France".'
          }
        },
        required: ['location']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description:
        'Search the web for current information — facts, current events, and product/pricing queries all work, returning multiple results with titles, snippets, and source URLs. For product or pricing questions specifically: compare results across at least 2-3 different sources/websites when available, cite the specific source links in your answer, and end with 2-3 relevant follow-up questions the user might want to ask next (e.g. availability, alternatives, or where to buy). If no useful results are found, tell the user honestly rather than guessing or making something up.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query — be specific for product lookups (include brand, model, and any identifying details).' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_calendar_events',
      description:
        "List the user's upcoming Google Calendar events. Use this when the user asks what's on their calendar or schedule. If the user hasn't connected Google Calendar, this returns a message telling them to connect it on the Calendar page — pass that along rather than pretending you checked.",
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description:
        "Create an event on the user's Google Calendar. Use this when the user asks to schedule, book, or add something to their calendar. If the user hasn't connected Google Calendar, this returns a message telling them to connect it on the Calendar page.",
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Short event title.' },
          start_iso: {
            type: 'string',
            description:
              'ISO 8601 datetime (with timezone offset) for the event start. Resolve relative times using the current date/time given in the system prompt.'
          },
          end_iso: {
            type: 'string',
            description: 'ISO 8601 datetime (with timezone offset) for the event end.'
          },
          description: { type: 'string', description: 'Optional longer event description.' }
        },
        required: ['summary', 'start_iso', 'end_iso']
      }
    }
  }
]
