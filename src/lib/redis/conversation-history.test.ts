import { describe, it, expect, vi, beforeEach } from 'vitest'

const redisMock = { get: vi.fn(), set: vi.fn(), del: vi.fn() }

vi.mock('./client', () => ({
  getRedis: () => redisMock
}))

const {
  getCachedHistory,
  setCachedHistory,
  appendCachedMessages,
  invalidateCachedHistory
} = await import('./conversation-history')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCachedHistory', () => {
  it('returns null on a cache miss', async () => {
    redisMock.get.mockResolvedValue(null)
    expect(await getCachedHistory('c1')).toBeNull()
  })

  it('maps cached messages onto the ChatMessage shape', async () => {
    redisMock.get.mockResolvedValue([{ role: 'user', content: 'hi', image_url: null }])
    const result = await getCachedHistory('c1')
    expect(result).toEqual([{ id: '', role: 'user', content: 'hi', created_at: '', image_url: null }])
  })

  it('degrades to null instead of throwing when Redis errors', async () => {
    redisMock.get.mockRejectedValue(new Error('redis down'))
    await expect(getCachedHistory('c1')).resolves.toBeNull()
  })
})

describe('setCachedHistory', () => {
  it('trims to the last 20 messages before writing', async () => {
    redisMock.set.mockResolvedValue('OK')
    const messages = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      role: 'user' as const,
      content: `msg ${i}`,
      created_at: '',
      image_url: null
    }))

    await setCachedHistory('c1', messages)

    expect(redisMock.set).toHaveBeenCalledTimes(1)
    const [key, stored, opts] = redisMock.set.mock.calls[0]
    expect(key).toBe('chat:history:c1')
    expect(stored).toHaveLength(20)
    expect(stored[0].content).toBe('msg 5') // oldest 5 dropped
    expect(stored[19].content).toBe('msg 24')
    expect(opts).toEqual({ ex: 3600 })
  })

  it('never throws when Redis errors', async () => {
    redisMock.set.mockRejectedValue(new Error('redis down'))
    await expect(setCachedHistory('c1', [])).resolves.toBeUndefined()
  })
})

describe('appendCachedMessages', () => {
  it('appends onto existing cached history and re-trims', async () => {
    redisMock.get.mockResolvedValue([{ role: 'assistant', content: 'old', image_url: null }])
    redisMock.set.mockResolvedValue('OK')

    await appendCachedMessages('c1', [{ role: 'user', content: 'new', image_url: null }])

    const [, stored] = redisMock.set.mock.calls[0]
    expect(stored).toEqual([
      { role: 'assistant', content: 'old', image_url: null },
      { role: 'user', content: 'new', image_url: null }
    ])
  })

  it('treats a missing cache entry as an empty history', async () => {
    redisMock.get.mockResolvedValue(null)
    redisMock.set.mockResolvedValue('OK')

    await appendCachedMessages('c1', [{ role: 'user', content: 'new', image_url: null }])

    const [, stored] = redisMock.set.mock.calls[0]
    expect(stored).toEqual([{ role: 'user', content: 'new', image_url: null }])
  })

  it('never throws when Redis errors', async () => {
    redisMock.get.mockRejectedValue(new Error('redis down'))
    await expect(appendCachedMessages('c1', [])).resolves.toBeUndefined()
  })
})

describe('invalidateCachedHistory', () => {
  it('deletes the conversation key', async () => {
    redisMock.del.mockResolvedValue(1)
    await invalidateCachedHistory('c1')
    expect(redisMock.del).toHaveBeenCalledWith('chat:history:c1')
  })

  it('never throws when Redis errors', async () => {
    redisMock.del.mockRejectedValue(new Error('redis down'))
    await expect(invalidateCachedHistory('c1')).resolves.toBeUndefined()
  })
})
