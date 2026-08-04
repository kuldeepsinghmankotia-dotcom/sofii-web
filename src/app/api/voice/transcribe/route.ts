import { NextRequest } from 'next/server'
import { toFile } from 'openai'
import { createClient } from '@/lib/supabase/server'
import { getGroqClient } from '@/lib/groq/client'

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

  try {
    const file = await toFile(arrayBuffer, 'audio.webm', { type: mimeType })
    const transcription = await getGroqClient().audio.transcriptions.create({
      file,
      model: TRANSCRIPTION_MODEL
    })

    return Response.json({ text: transcription.text })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Transcription error:', message)
    return new Response(message, { status: 500 })
  }
}
