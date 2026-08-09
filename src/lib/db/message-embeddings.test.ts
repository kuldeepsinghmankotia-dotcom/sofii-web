import { describe, it, expect, vi, beforeEach } from 'vitest'

const embedTextMock = vi.fn()
const embedTextsMock = vi.fn()

vi.mock('@/lib/gemini/embeddings', () => ({
  embedText: (...args: unknown[]) => embedTextMock(...args),
  embedTexts: (...args: unknown[]) => embedTextsMock(...args)
}))

const { isWorthEmbedding, embedMessages, recallRelatedMessages, backfillMessageEmbeddings } =
  await import('./message-embeddings')

type AnyClient = Parameters<typeof embedMessages>[0]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isWorthEmbedding', () => {
  it('rejects short filler turns that would only add index noise', () => {
    expect(isWorthEmbedding('ok')).toBe(false)
    expect(isWorthEmbedding('thanks!')).toBe(false)
    expect(isWorthEmbedding('   yes please   ')).toBe(false)
  })

  it('accepts a substantive message', () => {
    expect(
      isWorthEmbedding('I am trying to decide between the Bentley chronograph and a Tissot PRX.')
    ).toBe(true)
  })
})

describe('embedMessages', () => {
  it('skips the embedding API entirely when nothing is worth embedding', async () => {
    await embedMessages({} as AnyClient, [
      { id: '1', content: 'ok' },
      { id: '2', content: 'thanks' }
    ])
    expect(embedTextsMock).not.toHaveBeenCalled()
  })

  it('embeds only the substantive messages and writes each vector to its own row', async () => {
    embedTextsMock.mockResolvedValue([[0.1, 0.2]])
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ update })

    const longText = 'This is a genuinely substantive message about watches and pricing.'
    await embedMessages({ from } as unknown as AnyClient, [
      { id: 'short', content: 'ok' },
      { id: 'long', content: longText }
    ])

    expect(embedTextsMock).toHaveBeenCalledWith([longText])
    expect(eq).toHaveBeenCalledWith('id', 'long')
    expect(eq).not.toHaveBeenCalledWith('id', 'short')
  })

  it('never throws when the embedding API fails — the reply already went out', async () => {
    embedTextsMock.mockRejectedValue(new Error('gemini down'))
    await expect(
      embedMessages({} as AnyClient, [
        { id: '1', content: 'A sufficiently long message that would normally be embedded fine.' }
      ])
    ).resolves.toBeUndefined()
  })
})

describe('recallRelatedMessages', () => {
  it('excludes the current conversation from its own recall', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    await recallRelatedMessages({ rpc } as unknown as AnyClient, [0.1, 0.2], 'current-convo', 3)

    expect(rpc).toHaveBeenCalledWith(
      'match_messages',
      expect.objectContaining({ exclude_conversation_id: 'current-convo', match_count: 3 })
    )
  })

  it('returns [] instead of throwing when the RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('rpc failed') })
    const result = await recallRelatedMessages(
      { rpc } as unknown as AnyClient,
      [0.1],
      'convo'
    )
    expect(result).toEqual([])
  })
})

describe('backfillMessageEmbeddings', () => {
  // Builds a chainable Supabase query mock that resolves to `rows`.
  function clientReturning(rows: { id: string; content: string; created_at: string }[]) {
    const lt = vi.fn()
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn().mockReturnValue(chain)
    chain.is = vi.fn().mockReturnValue(chain)
    chain.order = vi.fn().mockReturnValue(chain)
    chain.limit = vi.fn().mockReturnValue(chain)
    chain.lt = lt.mockReturnValue(chain)
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null })
    // update path used by embedMessages
    chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    return { client: { from: vi.fn().mockReturnValue(chain) } as unknown as AnyClient, lt }
  }

  it('advances the cursor past short messages so the scan cannot deadlock', async () => {
    // The real bug this guards: messages below the length threshold are
    // never given an embedding, so a naive "first N rows where embedding
    // is null" query returns the same short rows forever and never reaches
    // older embeddable ones behind them.
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `short-${i}`,
      content: 'ok',
      created_at: `2026-01-0${i + 1}T00:00:00Z`
    }))
    const { client } = clientReturning(rows)

    const result = await backfillMessageEmbeddings(client, { batchSize: 3 })

    expect(result.embedded).toBe(0)
    expect(result.scanned).toBe(3)
    // Full batch -> must hand back a cursor so the caller keeps going
    // past these permanently-null rows.
    expect(result.nextCursor).toBe('2026-01-03T00:00:00Z')
  })

  it('stops (null cursor) when a partial batch signals the end of the table', async () => {
    const { client } = clientReturning([
      { id: 'a', content: 'ok', created_at: '2026-01-01T00:00:00Z' }
    ])
    const result = await backfillMessageEmbeddings(client, { batchSize: 50 })
    expect(result.nextCursor).toBeNull()
  })

  it('applies the cursor to the query when one is provided', async () => {
    const { client, lt } = clientReturning([])
    await backfillMessageEmbeddings(client, { before: '2026-01-05T00:00:00Z' })
    expect(lt).toHaveBeenCalledWith('created_at', '2026-01-05T00:00:00Z')
  })
})
