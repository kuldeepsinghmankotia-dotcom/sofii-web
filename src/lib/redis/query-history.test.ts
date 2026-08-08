import { describe, it, expect, vi, beforeEach } from 'vitest'

const redisMock = { get: vi.fn(), set: vi.fn() }

vi.mock('./client', () => ({
  getRedis: () => redisMock
}))

const { getQueryHistory, appendQueryExchange } = await import('./query-history')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getQueryHistory', () => {
  it('returns an empty array on a cache miss (not null - callers pass this straight to the graph)', async () => {
    redisMock.get.mockResolvedValue(null)
    expect(await getQueryHistory('t1')).toEqual([])
  })

  it('degrades to an empty array instead of throwing when Redis errors', async () => {
    redisMock.get.mockRejectedValue(new Error('redis down'))
    await expect(getQueryHistory('t1')).resolves.toEqual([])
  })
})

describe('appendQueryExchange', () => {
  it('trims to the last 10 exchanges before writing', async () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({ query: `q${i}`, answer: `a${i}` }))
    redisMock.get.mockResolvedValue(existing)
    redisMock.set.mockResolvedValue('OK')

    await appendQueryExchange('t1', { query: 'new question', answer: 'new answer' })

    const [key, stored, opts] = redisMock.set.mock.calls[0]
    expect(key).toBe('query:history:t1')
    expect(stored).toHaveLength(10)
    expect(stored[0].query).toBe('q1') // oldest dropped
    expect(stored[9]).toEqual({ query: 'new question', answer: 'new answer' })
    expect(opts).toEqual({ ex: 3600 })
  })

  it('treats a missing cache entry as an empty history', async () => {
    redisMock.get.mockResolvedValue(null)
    redisMock.set.mockResolvedValue('OK')

    await appendQueryExchange('t1', { query: 'q', answer: 'a' })

    const [, stored] = redisMock.set.mock.calls[0]
    expect(stored).toEqual([{ query: 'q', answer: 'a' }])
  })

  it('never throws when Redis errors', async () => {
    redisMock.get.mockRejectedValue(new Error('redis down'))
    await expect(appendQueryExchange('t1', { query: 'q', answer: 'a' })).resolves.toBeUndefined()
  })
})
