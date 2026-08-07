import OpenAI from 'openai'

// llama-3.3-70b-versatile is deprecated on Groq's free/developer tier
// (shutdown 2026-08-16); openai/gpt-oss-120b is Groq's recommended
// replacement. Overridable via GROQ_MODEL so a future deprecation doesn't
// require a code change, just an env var update.
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'

export function getGroqModel(): string {
  return process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL
}

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

// A different reasoning model family with different suppression knobs.
// `reasoning_format: 'hidden'` alone (this model's equivalent of gpt-oss's
// include_reasoning: false) only hides reasoning from the response — it
// does NOT bound how much of it gets generated, and that turned out to
// scale with image complexity in a way no fixed max_tokens ceiling could
// safely absorb: verified live in production, a real (non-synthetic) photo
// exhausted a 3072-token budget entirely on reasoning, twice, at different
// budget sizes, with zero visible output both times. gpt-oss's
// `reasoning_effort: 'low'` doesn't apply here either — this model rejects
// every value except 'none' and 'default'. `reasoning_effort: 'none'` is
// the actual fix: it disables reasoning generation altogether rather than
// just hiding an unbounded amount of it, confirmed live (774 completion
// tokens total, well inside a 1024 budget, for a request that had
// previously exhausted 3072 tokens of hidden reasoning with nothing left
// for the answer).
export interface GroqVisionReasoningParams {
  reasoning_format?: 'parsed' | 'raw' | 'hidden'
  reasoning_effort?: 'none' | 'default'
}

export const SUPPRESS_VISION_REASONING: GroqVisionReasoningParams = {
  reasoning_format: 'hidden',
  reasoning_effort: 'none'
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
