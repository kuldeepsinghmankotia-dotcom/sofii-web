import { NextRequest } from 'next/server'
import { toFile } from 'openai'
import { createClient } from '@/lib/supabase/server'
import { getGroqClient } from '@/lib/groq/client'
import { isSarvamConfigured } from '@/lib/sarvam/client'
import { transcribeWithSaaras } from '@/lib/sarvam/speech'

// Groq's hosted Whisper endpoint, not a local model: keeps setup free (same
// GROQ_API_KEY already used for chat) and avoids a local whisper.cpp/ffmpeg
// toolchain. Swappable later for a fully local/offline STT provider behind
// this same route contract.
const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  // Gated behind auth: this endpoint spends the app's shared Groq quota, so
  // it can't be left open to anonymous callers the way a local single-user
  // Electron IPC channel could be.
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const mimeType = request.headers.get('content-type') || 'audio/webm'
  const arrayBuffer = await request.arrayBuffer()

  if (arrayBuffer.byteLength === 0) {
    return new Response('Empty audio', { status: 400 })
  }

  // Optional ISO-639-1 hint (e.g. "hi"), passed via query string since the
  // request body here is the raw audio, not JSON. Whisper's own
  // auto-detection is noticeably less reliable on short clips — this is
  // what let real spoken Hindi come back mis-detected as Chinese. The
  // caller (chat-window.tsx) only ever sends this once it has *confident*
  // script-based evidence from an earlier transcription in the same
  // conversation, not a guess, since a wrong hint here actively degrades
  // accuracy rather than just picking a mediocre voice would.
  const languageParam = request.nextUrl.searchParams.get('language')
  const language = languageParam && /^[a-z]{2}$/.test(languageParam) ? languageParam : undefined

  // Saaras first when configured. It is meaningfully better than Whisper on
  // Indian languages and, critically, handles code-mixed Hinglish — the
  // register most of urban India actually speaks, and the one Whisper is
  // weakest on. It also returns the language it detected, which is strictly
  // better evidence than this app's script-range guessing: script cannot
  // tell Hindi from Marathi (both Devanagari), but Saaras can.
  //
  // India-first is a deliberate default here, not an accident: a user
  // speaking a non-Indic, non-English language would be better served by
  // Whisper, and reaches it only after a confident hint routes them there.
  // If this app's audience ever stops being India-centred, invert this.
  if (isSarvamConfigured()) {
    const result = await transcribeWithSaaras(arrayBuffer, mimeType, language ?? null)

    if (result) {
      return Response.json({
        text: result.text,
        // Surfaced so the client can hold a hint grounded in the model's own
        // detection rather than re-deriving one from the script of the text
        // it just received.
        languageCode: result.languageCode,
        languageProbability: result.languageProbability
      })
    }
    // Fell through: Sarvam unavailable or errored. Whisper below.
  }

  try {
    const file = await toFile(arrayBuffer, 'audio.webm', { type: mimeType })
    const transcription = await getGroqClient().audio.transcriptions.create({
      file,
      model: TRANSCRIPTION_MODEL,
      ...(language ? { language } : {})
    })

    return Response.json({ text: transcription.text })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Transcription error:', message)
    return new Response(message, { status: 500 })
  }
}
