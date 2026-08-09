import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGroqClient } from '@/lib/groq/client'
import { getSpeakRatelimit } from '@/lib/redis/ratelimit'

// Groq hosts Orpheus (Canopy Labs), a genuinely natural neural TTS model —
// the same class of voice quality other assistant apps use, a real step up
// from the browser's native SpeechSynthesis voices (still used as the
// fallback for every language this model doesn't cover — see
// lib/voice/cloud-tts.ts). English-only at the time this was wired up;
// Groq also hosts an Arabic model (canopylabs/orpheus-arabic-saudi) if
// that's ever worth adding as a second supported language.
const CLOUD_TTS_MODEL = 'canopylabs/orpheus-v1-english'
const DEFAULT_VOICE = 'tara'
// Matches the OpenAI-compatible API's own 4096-char input cap with a
// little headroom, rather than letting a long reply hit a 400 downstream.
const MAX_INPUT_CHARS = 4000

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const rateLimit = await getSpeakRatelimit().limit(user.id)
  if (!rateLimit.success) {
    return new Response('Rate limit exceeded — please slow down.', {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000))) }
    })
  }

  const body = (await request.json()) as { text?: string; voice?: string }
  const text = body.text?.trim()

  if (!text) {
    return new Response('Missing text', { status: 400 })
  }

  try {
    const upstream = await getGroqClient().audio.speech.create({
      model: CLOUD_TTS_MODEL,
      voice: body.voice || DEFAULT_VOICE,
      input: text.slice(0, MAX_INPUT_CHARS),
      response_format: 'mp3'
    })

    const audio = await upstream.arrayBuffer()
    return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Expected and non-alarming until the model's terms are accepted in
    // the Groq console (a one-time, human-only step — see this project's
    // notes on the Upstash marketplace integration for the same class of
    // blocker) — the client falls back to the browser voice on any
    // non-200 here, so this is never a dead end for the user.
    console.error('Cloud TTS error:', message)
    return new Response(message, { status: 502 })
  }
}
