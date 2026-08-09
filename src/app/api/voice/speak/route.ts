import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGroqClient } from '@/lib/groq/client'
import { getSpeakRatelimit } from '@/lib/redis/ratelimit'

// Groq hosts Orpheus (Canopy Labs), a genuinely natural neural TTS model —
// the same class of voice quality other assistant apps use, a real step up
// from the browser's native SpeechSynthesis voices (the final fallback if
// every cloud option below fails — see lib/voice/cloud-tts.ts).
//
// response_format must be 'wav' — verified live against the real API,
// 'mp3' (a normally-valid OpenAI-compatible value) 400s on this model.
// Voice names are also model-specific and NOT the OpenAI-standard set
// (alloy/nova/etc.) — verified live: the real accepted list for the
// English model is [autumn diana hannah austin daniel troy].
const GROQ_MODELS: Record<string, { model: string; voice: string }> = {
  en: { model: 'canopylabs/orpheus-v1-english', voice: 'autumn' },
  // Not yet usable — canopylabs/orpheus-arabic-saudi has its own separate
  // terms-acceptance gate on Groq's side (confirmed live: a distinct
  // model_terms_required error from the English model's), and its voice
  // names haven't been verified live yet either. Left wired up so it
  // activates the same way English did, with no further deploy needed,
  // the moment those terms are accepted.
  ar: { model: 'canopylabs/orpheus-arabic-saudi', voice: 'autumn' }
}

// Matches the OpenAI-compatible API's own 4096-char input cap with a
// little headroom, rather than letting a long reply hit a 400 downstream.
const MAX_INPUT_CHARS = 4000

async function speakViaGroq(text: string, lang: string): Promise<Response | null> {
  const config = GROQ_MODELS[lang]
  if (!config) return null

  try {
    const upstream = await getGroqClient().audio.speech.create({
      model: config.model,
      voice: config.voice,
      input: text,
      response_format: 'wav'
    })
    const audio = await upstream.arrayBuffer()
    return new Response(audio, { headers: { 'Content-Type': 'audio/wav' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Expected and non-alarming for a model whose terms aren't accepted
    // yet in the Groq console (a one-time, human-only step) — returning
    // null here just means "try the next provider", not a hard failure.
    console.error('Groq TTS error:', message)
    return null
  }
}

// ElevenLabs' multilingual model speaks whatever language the input text
// is in using the same voice — verified live: the same English-labeled
// voice produced real, correct-sounding Hindi and Chinese audio, not just
// English. One fixed voice covers every language this way, unlike Groq's
// one-model-per-language setup above, so there's no per-language voice
// table to maintain here. Used for every language Groq's two models don't
// cover — genuinely broad coverage (~30 languages) rather than the
// English/Arabic-only ceiling the Groq-only setup had.
const ELEVENLABS_MODEL = 'eleven_multilingual_v2'
// "Sarah" — a clear, warm voice; picked from the account's default voice
// library, not a custom clone.
const ELEVENLABS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'

async function speakViaElevenLabs(text: string): Promise<Response | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return null

  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL })
    })

    if (!upstream.ok) {
      console.error('ElevenLabs TTS error:', upstream.status, await upstream.text())
      return null
    }

    const audio = await upstream.arrayBuffer()
    return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('ElevenLabs TTS error:', message)
    return null
  }
}

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

  const body = (await request.json()) as { text?: string; lang?: string }
  const text = body.text?.trim()?.slice(0, MAX_INPUT_CHARS)

  if (!text) {
    return new Response('Missing text', { status: 400 })
  }

  const lang = body.lang ?? 'en'

  // Groq first for the languages it covers (free, already fast/working);
  // ElevenLabs for everything else. Either can return null (rather than
  // throwing) on any failure, so this always tries the next option instead
  // of giving up after the first provider that isn't available.
  const response = (await speakViaGroq(text, lang)) ?? (await speakViaElevenLabs(text))

  if (!response) {
    // The client falls back to the browser voice on any non-200 here, so
    // this is never a dead end for the user — both providers are
    // unavailable (terms not accepted, no API key configured, rate
    // limited, or a real outage).
    return new Response('Cloud TTS unavailable', { status: 502 })
  }

  return response
}
