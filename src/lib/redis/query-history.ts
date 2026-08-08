import { getRedis } from './client'

// Same cache-aside pattern as conversation-history.ts, applied to the
// Documents Q&A query-agent so it can hold short-term thread context too
// ("ensure the same implementation for all the agentic workflows"). Unlike
// chat, this workflow has no durable conversation row in Postgres - Redis
// IS the only place this history lives, so a thread's memory is inherently
// best-effort and bounded by TTL_SECONDS, not a source-of-truth cache.
const MAX_CACHED_EXCHANGES = 10
const TTL_SECONDS = 60 * 60

export interface QueryExchange {
  query: string
  answer: string
}

function historyKey(threadId: string): string {
  return `query:history:${threadId}`
}

export async function getQueryHistory(threadId: string): Promise<QueryExchange[]> {
  try {
    const redis = getRedis()
    const cached = await redis.get<QueryExchange[]>(historyKey(threadId))
    return cached ?? []
  } catch (error) {
    console.error('Redis query-history read error:', error)
    return []
  }
}

export async function appendQueryExchange(threadId: string, exchange: QueryExchange): Promise<void> {
  try {
    const redis = getRedis()
    const existing = (await redis.get<QueryExchange[]>(historyKey(threadId))) ?? []
    const updated = [...existing, exchange].slice(-MAX_CACHED_EXCHANGES)
    await redis.set(historyKey(threadId), updated, { ex: TTL_SECONDS })
  } catch (error) {
    console.error('Redis query-history append error:', error)
  }
}
