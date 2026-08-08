import { Ratelimit } from '@upstash/ratelimit'
import { getRedis } from './client'

// Sliding-window, per-authenticated-user limits on the three routes that
// call a paid/quota-limited backend (Groq, Gemini, Tavily) or trigger real
// work on the ingestion Mac. Deliberately generous — this exists to stop
// runaway cost/abuse (nothing was rate-limited before this), not to
// throttle normal use. No analytics (skips extra Redis commands per call
// for data this app doesn't otherwise use).
let chatLimiter: Ratelimit | null = null
let queryLimiter: Ratelimit | null = null
let ingestLimiter: Ratelimit | null = null

export function getChatRatelimit(): Ratelimit {
  if (!chatLimiter) {
    chatLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(30, '10 m'),
      prefix: 'ratelimit:chat'
    })
  }
  return chatLimiter
}

export function getQueryRatelimit(): Ratelimit {
  if (!queryLimiter) {
    queryLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(20, '10 m'),
      prefix: 'ratelimit:query'
    })
  }
  return queryLimiter
}

// Ingestion is heavier (Storage write + a real OCR/graph run on the Mac),
// so its budget is per-hour rather than per-10-minutes.
export function getIngestRatelimit(): Ratelimit {
  if (!ingestLimiter) {
    ingestLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(15, '1 h'),
      prefix: 'ratelimit:ingest'
    })
  }
  return ingestLimiter
}
