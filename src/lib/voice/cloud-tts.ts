// Groq-hosted Orpheus TTS (see api/voice/speak/route.ts) — genuinely
// natural neural voice quality, a real step up from the browser's native
// SpeechSynthesis voices this app otherwise relies on. Covers English (live)
// and Arabic (wired up, pending its own separate terms acceptance on
// Groq's side — see the API route's own comment) today; every other
// language still goes through select-voice.ts's browser-voice path, which
// already picks the best available system voice per language.
const CLOUD_TTS_MAX_CHARS = 4000

const CLOUD_LANGS = new Set(['en', 'ar'])

export function supportsCloudVoice(lang: string): boolean {
  return CLOUD_LANGS.has(lang.toLowerCase().split('-')[0])
}

// Never throws: returns null on any failure (network error, the Groq-side
// terms-acceptance gate not cleared yet, rate limiting, etc.) so callers
// can unconditionally fall back to the browser voice path without their
// own error handling — a cloud TTS outage should never be a dead end for
// spoken replies.
export async function fetchCloudSpeech(text: string, lang: string): Promise<Blob | null> {
  try {
    const response = await fetch('/api/voice/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, CLOUD_TTS_MAX_CHARS), lang: lang.split('-')[0] })
    })
    if (!response.ok) return null
    return await response.blob()
  } catch {
    return null
  }
}
