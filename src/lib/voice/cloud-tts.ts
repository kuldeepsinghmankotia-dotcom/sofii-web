// Groq-hosted Orpheus TTS (see api/voice/speak/route.ts) — genuinely
// natural neural voice quality, a real step up from the browser's native
// SpeechSynthesis voices this app otherwise relies on. English-only right
// now (Orpheus's only broadly-available model on Groq at time of
// writing), so every other language still goes through select-voice.ts's
// browser-voice path, which already picks the best available system
// voice per language.
const CLOUD_TTS_MAX_CHARS = 4000

export function supportsCloudVoice(lang: string): boolean {
  return lang.toLowerCase().startsWith('en')
}

// Never throws: returns null on any failure (network error, the Groq-side
// terms-acceptance gate not cleared yet, rate limiting, etc.) so callers
// can unconditionally fall back to the browser voice path without their
// own error handling — a cloud TTS outage should never be a dead end for
// spoken replies.
export async function fetchCloudSpeech(text: string): Promise<Blob | null> {
  try {
    const response = await fetch('/api/voice/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, CLOUD_TTS_MAX_CHARS) })
    })
    if (!response.ok) return null
    return await response.blob()
  } catch {
    return null
  }
}
