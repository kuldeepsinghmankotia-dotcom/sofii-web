// Sarvam AI — Indic speech, translation and document models.
//
// Used for Indian languages specifically, where it is materially better
// than the general-purpose providers this app uses elsewhere: Saaras has an
// explicit code-mixed mode (Hinglish, which is how much of urban India
// actually speaks) and Bulbul covers 11 Indian languages against the two
// (Hindi, Tamil) that ElevenLabs' multilingual model offers.
//
// Everything here is optional. With no SARVAM_API_KEY configured the app
// behaves exactly as before, falling back to Whisper and Groq/ElevenLabs —
// so this can ship dark and activate by adding one env var.

const SARVAM_BASE_URL = 'https://api.sarvam.ai'

// Sarvam's own header. It also accepts `Authorization: Bearer` for
// OpenAI-compatible tooling, but the docs name this one as primary, so it
// is what we send.
const AUTH_HEADER = 'api-subscription-key'

export function getSarvamApiKey(): string | null {
  return process.env.SARVAM_API_KEY ?? null
}

export function isSarvamConfigured(): boolean {
  return Boolean(getSarvamApiKey())
}

/**
 * Timeout for every Sarvam call.
 *
 * These sit directly in a user-facing voice interaction, where a stall is
 * worse than a fallback: if Sarvam is slow we would rather transcribe with
 * Whisper and be slightly less accurate than leave someone holding a dead
 * microphone. Matches the reasoning behind the ingestion handoff timeout.
 */
const REQUEST_TIMEOUT_MS = 20_000

export interface SarvamRequestOptions {
  path: string
  body: FormData | Record<string, unknown>
  signal?: AbortSignal
}

/**
 * Single entry point for Sarvam HTTP calls.
 *
 * Returns null rather than throwing on *any* failure — missing key, non-2xx,
 * network error, timeout. Every caller here has a working fallback provider,
 * so a Sarvam outage must degrade quality, never break the feature. Callers
 * that need to distinguish failure modes should log; none currently do.
 */
export async function sarvamRequest<T>({ path, body, signal }: SarvamRequestOptions): Promise<T | null> {
  const apiKey = getSarvamApiKey()
  if (!apiKey) return null

  const isForm = body instanceof FormData

  try {
    const response = await fetch(`${SARVAM_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        [AUTH_HEADER]: apiKey,
        // Must NOT be set for FormData — fetch has to generate the
        // multipart boundary itself, and setting it manually produces a
        // request the server cannot parse.
        ...(isForm ? {} : { 'Content-Type': 'application/json' })
      },
      body: isForm ? body : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })

    if (!response.ok) {
      console.error('Sarvam request failed:', path, response.status, (await response.text()).slice(0, 300))
      return null
    }

    return (await response.json()) as T
  } catch (error) {
    console.error('Sarvam request error:', path, error instanceof Error ? error.message : error)
    return null
  }
}
