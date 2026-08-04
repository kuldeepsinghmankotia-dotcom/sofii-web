import OpenAI from 'openai'

// llama-3.3-70b-versatile is deprecated on Groq's free/developer tier
// (shutdown 2026-08-16); openai/gpt-oss-120b is Groq's recommended
// replacement. Overridable via GROQ_MODEL so a future deprecation doesn't
// require a code change, just an env var update.
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'

export function getGroqModel(): string {
  return process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL
}

export const SYSTEM_PROMPT = 'You are SOFII, a friendly, intelligent AI assistant.'

// Groq-specific request fields not present in the openai SDK's types (hence
// the intersection type on the call site rather than plain params).
// openai/gpt-oss-120b is a reasoning model: by default it streams hidden
// chain-of-thought as a separate `reasoning` delta field in addition to the
// real answer in `content`, and that reasoning still consumes tokens even
// when unused — verified against the live API, where a tight token budget
// was exhausted by reasoning before any `content` was produced at all.
// include_reasoning: false suppresses it; reasoning_effort: 'low' keeps it
// minimal, which matters given the free tier's tight TPM budget.
export interface GroqReasoningParams {
  reasoning_effort?: 'low' | 'medium' | 'high'
  include_reasoning?: boolean
}

export const SUPPRESS_REASONING: GroqReasoningParams = {
  reasoning_effort: 'low',
  include_reasoning: false
}

// The default text model (openai/gpt-oss-120b) rejects vision content
// outright ("messages[0].content must be a string" — verified live), so any
// turn with an image anywhere in context switches to this model instead.
// Picked by testing every model Groq's /models endpoint currently lists: it
// was the only one that accepted an image_url content part. Known
// limitation, not a bug to chase further: verified live that its visual
// accuracy has real run-to-run variance on the same image (a two-tone test
// image was described correctly on most runs but with a hallucinated extra
// detail on one run) — expected from a small free vision model, not
// something fixable at the integration layer.
export const VISION_MODEL = 'qwen/qwen3.6-27b'

// A different reasoning model family with a different suppression knob —
// this one uses `reasoning_format` (parsed/raw/hidden), not
// reasoning_effort/include_reasoning. Same underlying hazard as
// SUPPRESS_REASONING though, confirmed live: with reasoning_format hidden
// and a tight max_tokens, all of it still went to reasoning_tokens and
// content came back empty with finish_reason "length" — so callers using
// VISION_MODEL still need generous max_tokens headroom.
export interface GroqVisionReasoningParams {
  reasoning_format?: 'parsed' | 'raw' | 'hidden'
}

export const SUPPRESS_VISION_REASONING: GroqVisionReasoningParams = {
  reasoning_format: 'hidden'
}

let client: OpenAI | undefined

// Constructed lazily (on first real use) rather than at module-load time, so
// a route handler invoked before env vars are ready never bakes in a missing
// key. In Next.js route handlers this is less load-bearing than it was in
// Electron's main process, but keeping the same lazy pattern avoids
// reintroducing the bug the Electron app already had to fix.
export function getGroqClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1'
    })
  }
  return client
}
