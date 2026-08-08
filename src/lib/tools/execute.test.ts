import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

vi.mock('@/lib/db/memories', () => ({ createMemory: vi.fn() }))
vi.mock('@/lib/db/reminders', () => ({ createReminder: vi.fn(), listPendingReminders: vi.fn() }))
vi.mock('@/lib/weather/weather', () => ({ getWeather: vi.fn() }))
vi.mock('@/lib/search/tavily', () => ({ searchWeb: vi.fn() }))
vi.mock('@/lib/google/calendar', () => ({
  createCalendarEvent: vi.fn(),
  getValidAccessToken: vi.fn(),
  listUpcomingEvents: vi.fn()
}))

const { executeToolCall } = await import('./execute')
const { createMemory } = await import('@/lib/db/memories')
const { createReminder, listPendingReminders } = await import('@/lib/db/reminders')
const { getWeather } = await import('@/lib/weather/weather')
const { searchWeb } = await import('@/lib/search/tavily')
const { getValidAccessToken } = await import('@/lib/google/calendar')

const fakeSupabase = {} as SupabaseClient<Database>
const userId = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('executeToolCall - dispatch', () => {
  it('returns an error for malformed JSON arguments', async () => {
    const result = await executeToolCall(
      { name: 'create_memory', argumentsJson: '{not json' },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/could not parse arguments/i)
  })

  it('returns an error for an unknown tool name', async () => {
    const result = await executeToolCall({ name: 'nonexistent_tool', argumentsJson: '{}' }, fakeSupabase, userId)
    expect(result).toMatch(/unknown tool/i)
  })
})

describe('create_reminder', () => {
  it('requires content', async () => {
    const result = await executeToolCall(
      { name: 'create_reminder', argumentsJson: JSON.stringify({ scheduled_at_iso: '2026-01-01T00:00:00Z' }) },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/content is required/i)
  })

  it('rejects an unparseable date', async () => {
    const result = await executeToolCall(
      { name: 'create_reminder', argumentsJson: JSON.stringify({ content: 'x', scheduled_at_iso: 'not-a-date' }) },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/could not parse/i)
    expect(createReminder).not.toHaveBeenCalled()
  })

  it('saves a valid reminder', async () => {
    vi.mocked(createReminder).mockResolvedValue(undefined as never)
    const result = await executeToolCall(
      {
        name: 'create_reminder',
        argumentsJson: JSON.stringify({ content: 'call mom', scheduled_at_iso: '2026-01-01T00:00:00Z' })
      },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/reminder saved/i)
    expect(createReminder).toHaveBeenCalledWith(fakeSupabase, expect.objectContaining({ userId, content: 'call mom' }))
  })
})

describe('create_memory', () => {
  it('requires non-empty content', async () => {
    const result = await executeToolCall(
      { name: 'create_memory', argumentsJson: JSON.stringify({ content: '   ' }) },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/content is required/i)
    expect(createMemory).not.toHaveBeenCalled()
  })

  it('saves a valid memory', async () => {
    vi.mocked(createMemory).mockResolvedValue(undefined as never)
    const result = await executeToolCall(
      { name: 'create_memory', argumentsJson: JSON.stringify({ content: 'likes tea' }) },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/memory saved/i)
  })
})

describe('list_reminders', () => {
  it('reports no upcoming reminders', async () => {
    vi.mocked(listPendingReminders).mockResolvedValue([])
    const result = await executeToolCall({ name: 'list_reminders', argumentsJson: '{}' }, fakeSupabase, userId)
    expect(result).toBe('No upcoming reminders.')
  })
})

describe('get_weather', () => {
  it('requires a location', async () => {
    const result = await executeToolCall({ name: 'get_weather', argumentsJson: '{}' }, fakeSupabase, userId)
    expect(result).toMatch(/location is required/i)
  })

  it('surfaces a client error as a tool error string rather than throwing', async () => {
    vi.mocked(getWeather).mockRejectedValue(new Error('API down'))
    const result = await executeToolCall(
      { name: 'get_weather', argumentsJson: JSON.stringify({ location: 'Delhi' }) },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/error fetching weather/i)
  })
})

describe('search_web', () => {
  it('requires a query', async () => {
    const result = await executeToolCall({ name: 'search_web', argumentsJson: '{}' }, fakeSupabase, userId)
    expect(result).toMatch(/query is required/i)
  })

  it('returns search results on success', async () => {
    vi.mocked(searchWeb).mockResolvedValue('- Result: something (https://example.com)')
    const result = await executeToolCall(
      { name: 'search_web', argumentsJson: JSON.stringify({ query: 'watch price' }) },
      fakeSupabase,
      userId
    )
    expect(result).toContain('example.com')
  })
})

describe('calendar tools', () => {
  it('tells the model calendar is not connected rather than failing', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue(null)
    const result = await executeToolCall({ name: 'list_calendar_events', argumentsJson: '{}' }, fakeSupabase, userId)
    expect(result).toMatch(/not connected/i)
  })

  it('validates create_calendar_event dates before touching the network', async () => {
    const result = await executeToolCall(
      {
        name: 'create_calendar_event',
        argumentsJson: JSON.stringify({ summary: 'Meeting', start_iso: 'bad', end_iso: 'bad' })
      },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/could not parse "bad" as a date/i)
    expect(getValidAccessToken).not.toHaveBeenCalled()
  })
})

describe('document tools', () => {
  it('summarize_document requires document_id', async () => {
    const result = await executeToolCall({ name: 'summarize_document', argumentsJson: '{}' }, fakeSupabase, userId)
    expect(result).toMatch(/document_id is required/i)
  })

  it('compare_documents requires at least two document_ids', async () => {
    const result = await executeToolCall(
      { name: 'compare_documents', argumentsJson: JSON.stringify({ document_ids: ['d1'] }) },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/at least two document_ids/i)
  })

  it('extract_structured_data requires both document_id and request', async () => {
    const result = await executeToolCall(
      { name: 'extract_structured_data', argumentsJson: JSON.stringify({ document_id: 'd1' }) },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/request is required/i)
  })

  it('reports a clear error when the ingestion service is not configured', async () => {
    vi.stubEnv('INGEST_SERVICE_URL', '')
    vi.stubEnv('INGEST_SERVICE_SECRET', '')
    const result = await executeToolCall(
      { name: 'summarize_document', argumentsJson: JSON.stringify({ document_id: 'd1' }) },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/not configured/i)
  })

  it('reports the service as offline when the request fails to reach it', async () => {
    vi.stubEnv('INGEST_SERVICE_URL', 'https://ingest.example.com')
    vi.stubEnv('INGEST_SERVICE_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network unreachable'))
    )
    const result = await executeToolCall(
      { name: 'summarize_document', argumentsJson: JSON.stringify({ document_id: 'd1' }) },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/temporarily offline/i)
  })

  it('reports the service as offline on a 503 response', async () => {
    vi.stubEnv('INGEST_SERVICE_URL', 'https://ingest.example.com')
    vi.stubEnv('INGEST_SERVICE_SECRET', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 })
    )
    const result = await executeToolCall(
      { name: 'compare_documents', argumentsJson: JSON.stringify({ document_ids: ['d1', 'd2'] }) },
      fakeSupabase,
      userId
    )
    expect(result).toMatch(/temporarily offline/i)
  })

  it('returns the answer on success', async () => {
    vi.stubEnv('INGEST_SERVICE_URL', 'https://ingest.example.com')
    vi.stubEnv('INGEST_SERVICE_SECRET', 'secret')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ answer: 'This document is about widgets.' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeToolCall(
      { name: 'summarize_document', argumentsJson: JSON.stringify({ document_id: 'd1' }) },
      fakeSupabase,
      userId
    )
    expect(result).toBe('This document is about widgets.')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ingest.example.com/query')
    const body = JSON.parse(options.body)
    expect(body).toEqual({
      query: 'Summarize this document.',
      user_id: userId,
      document_ids: ['d1'],
      intent: 'summarize_document'
    })
  })
})
