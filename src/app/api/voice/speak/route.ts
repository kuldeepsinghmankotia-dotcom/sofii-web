import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGroqClient } from '@/lib/groq/client'
import { getSpeakRatelimit } from '@/lib/redis/ratelimit'

// Groq hosts Orpheus (Canopy Labs), a genuinely natural neural TTS model —
// the same class of voice quality other assistant apps use, a real step up
// from the browser's native SpeechSynthesis voices (still used as the
// fallback for every language neither model below covers — see
// lib/voice/cloud-tts.ts).
//
// response_format must be 'wav' — verified live against the real API,
// 'mp3' (a normally-valid OpenAI-compatible value) 400s on this model.
// Voice names are also model-specific and NOT the OpenAI-standard set
// (alloy/nova/etc.) — verified live: the real accepted list for the
// English model is [autumn diana hannah austin daniel troy].
const MODELS: Record<string, { model: string; voice: string }> = {
  en: { model: 'canopylabs/orpheus-v1-english', voice: 'autumn' },
  // Not yet usable — canopylabs/orpheus-arabic-saudi has its own separate
  // terms-acceptance gate on Groq's side (confirmed live: a distinct
  // model_terms_required error from the English model's), and its voice
  // names haven't been verified live yet either. Left wired up so it
  // activates the same way English did the moment those terms are
  // accepted, rather than needing a second deploy — falls through to the
  // browser voice on the terms-required error in the meantime, same as
  // every other cloud TTS failure mode.
  ar: { model: 'canopylabs/orpheus-arabic-saudi', voice: 'autumn' }
}

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

  const body = (await request.json()) as { text?: string; lang?: string }
  const text = body.text?.trim()

  if (!text) {
    return new Response('Missing text', { status: 400 })
  }

  const config = MODELS[body.lang ?? 'en'] ?? MODELS.en

  try {
    const upstream = await getGroqClient().audio.speech.create({
      model: config.model,
      voice: config.voice,
      input: text.slice(0, MAX_INPUT_CHARS),
      response_format: 'wav'
    })

    const audio = await upstream.arrayBuffer()
    return new Response(audio, { headers: { 'Content-Type': 'audio/wav' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Expected and non-alarming for a model whose terms aren't accepted
    // yet in the Groq console (a one-time, human-only step — see this
    // project's notes on the Upstash marketplace integration for the same
    // class of blocker) — the client falls back to the browser voice on
    // any non-200 here, so this is never a dead end for the user.
    console.error('Cloud TTS error:', message)
    return new Response(message, { status: 502 })
  }
}
