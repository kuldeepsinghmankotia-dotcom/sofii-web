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
  },
  {
    type: 'function',
    function: {
      name: 'cancel_reminder',
      description:
        "Cancel a reminder the user no longer wants. Call list_reminders first to get the reminder's id — never guess one.",
      parameters: {
        type: 'object',
        properties: {
          reminder_id: { type: 'string', description: 'The id from list_reminders.' }
        },
        required: ['reminder_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_reminder',
      description:
        "Move a pending reminder to a different time (\"push that to tomorrow\", \"make it 6pm instead\"). Call list_reminders first to get the id. Only works on reminders that haven't fired yet.",
      parameters: {
        type: 'object',
        properties: {
          reminder_id: { type: 'string', description: 'The id from list_reminders.' },
          scheduled_at_iso: {
            type: 'string',
            description:
              'New ISO 8601 datetime (with timezone offset). Resolve relative times using the current date/time in the system prompt.'
          }
        },
        required: ['reminder_id', 'scheduled_at_iso']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_memories',
      description:
        "List the durable facts you've stored about the user. Use before updating or forgetting one, to get its id, or when the user asks what you know about them.",
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_memory',
      description:
        'Correct a stored fact about the user when they tell you it changed ("I moved to Berlin", "it\'s 3 kids now, not 2"). Call list_memories first for the id. Prefer this over creating a duplicate memory that contradicts an old one.',
      parameters: {
        type: 'object',
        properties: {
          memory_id: { type: 'string', description: 'The id from list_memories.' },
          content: {
            type: 'string',
            description: 'The corrected fact, written as a short standalone statement.'
          }
        },
        required: ['memory_id', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'forget_memory',
      description:
        'Permanently delete a stored fact when the user asks you to forget something. Call list_memories first for the id. This cannot be undone, so only do it on a clear request.',
      parameters: {
        type: 'object',
        properties: {
          memory_id: { type: 'string', description: 'The id from list_memories.' }
        },
        required: ['memory_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_webpage',
      description:
        "Fetch and read the actual text of a web page. Use this whenever the user pastes a link or asks about a specific page — read it rather than guessing from the URL or searching for it. For general questions with no specific page in mind, use search_web instead.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full http(s) URL to read.' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description:
        "Evaluate an arithmetic expression exactly. Use this for ANY non-trivial calculation — percentages, totals, unit maths, compound figures — rather than working it out yourself, which is error-prone. Supports + - * / % ^, parentheses, and functions like sqrt, round, min, max, log. Understands '20% of 250'.",
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'The expression, e.g. "1250 * 1.18" or "20% of 250".'
          }
        },
        required: ['expression']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_note',
      description:
        "Save text as a permanent, searchable document in the user's library. Use when the user asks you to save, keep, or remember something substantial (notes, a plan, a draft, research) — as opposed to a one-line fact about themselves, which belongs in create_memory.",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short descriptive title for the note.' },
          content: { type: 'string', description: 'The full text to save.' }
        },
        required: ['title', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_everything',
      description:
        "Search the user's documents, past conversations, and stored memories all at once. Use this when you don't know which of those a piece of information would be in — it's the broad 'have I got anything on this?' search. Prefer the more specific recall_past_conversations or summarize_document when you already know where to look.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to look for, described as a phrase — this is a semantic search.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_calendar_event',
      description:
        "Change an existing Google Calendar event — move its time, rename it, or edit its description. Call list_calendar_events first to get the event id. Only send the fields that are actually changing.",
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'The id from list_calendar_events.' },
          summary: { type: 'string', description: 'New title, if changing it.' },
          start_iso: { type: 'string', description: 'New ISO 8601 start, if changing it.' },
          end_iso: { type: 'string', description: 'New ISO 8601 end, if changing it.' },
          description: { type: 'string', description: 'New description, if changing it.' }
        },
        required: ['event_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_calendar_event',
      description:
        'Delete a Google Calendar event when the user cancels something. Call list_calendar_events first to get the id. This cannot be undone.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'The id from list_calendar_events.' }
        },
        required: ['event_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recall_past_conversations',
      description:
        "Search the user's earlier conversations with you for what was previously said about a topic. Use this whenever the user refers to something from the past that isn't in the current conversation — \"what did we decide about X\", \"the thing I mentioned last week\", \"remind me what you suggested\" — instead of guessing or saying you have no memory. Relevant excerpts from other conversations may already be provided in your context; only call this when you need to search for something more specific than what's already there.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'What to search for, as a descriptive phrase about the topic (e.g. "the Bentley watch price comparison", "which laptop to buy"). This is a semantic search, so describe the subject rather than using keywords alone.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'summarize_document',
      description:
        'Summarize one of the user\'s uploaded documents in full. Use this when the user asks for a summary of a specific document, rather than answering from a short excerpt. Pick document_id from the "Available documents" list given in the system prompt — match by filename; if it\'s ambiguous which document they mean, ask instead of guessing.',
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'string',
            description: 'The id of the document to summarize, from the Available documents list.'
          }
        },
        required: ['document_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compare_documents',
      description:
        'Compare two or more of the user\'s uploaded documents, noting similarities and differences. Use this when the user asks to compare, contrast, or see how documents differ. Pick document_ids from the "Available documents" list given in the system prompt.',
      parameters: {
        type: 'object',
        properties: {
          document_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'At least two document ids from the Available documents list.'
          }
        },
        required: ['document_ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'extract_structured_data',
      description:
        'Extract specific fields or data points from one of the user\'s uploaded documents into structured form (e.g. "pull the vendor, date, and total from this invoice", "list each row as a record"). Use this instead of answering from a short excerpt when the user wants precise, complete fields pulled out. Pick document_id from the "Available documents" list given in the system prompt.',
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'string',
            description: 'The id of the document to extract from, from the Available documents list.'
          },
          request: {
            type: 'string',
            description: "What to extract, in the user's own words (e.g. \"name, date, and amount\")."
          }
        },
        required: ['document_id', 'request']
      }
    }
  }
]
