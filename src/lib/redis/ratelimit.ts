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
let speakLimiter: Ratelimit | null = null
let whatsappLimiter: Ratelimit | null = null

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

// Cloud TTS (Groq-hosted Orpheus) synthesizes real audio per call — a
// materially heavier operation than a chat completion, so its own budget
// rather than sharing the chat limiter.
export function getSpeakRatelimit(): Ratelimit {
  if (!speakLimiter) {
    speakLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(20, '10 m'),
      prefix: 'ratelimit:speak'
    })
  }
  return speakLimiter
}

// WhatsApp messages get their own budget rather than sharing the chat
// limiter. The channel is inherently chatty - people fire off several short
// messages in a row where they would send one longer one on the web - and a
// shared bucket would let a WhatsApp burst lock the user out of the app they
// are also using. Keyed by account, since model spend belongs to the
// account, not to the phone number.
export function getWhatsAppRatelimit(): Ratelimit {
  if (!whatsappLimiter) {
    whatsappLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(30, '10 m'),
      prefix: 'ratelimit:whatsapp'
    })
  }
  return whatsappLimiter
}
