// Cloud TTS (see api/voice/speak/route.ts) — genuinely natural neural
// voice quality, a real step up from the browser's native SpeechSynthesis
// voices this app otherwise relies on. Groq (Orpheus) covers English live
// and Arabic once its terms are accepted; ElevenLabs' multilingual model
// covers everything else in this list — verified live producing real
// Hindi and Chinese audio from the same voice. Any language NOT in this
// set still goes through select-voice.ts's browser-voice path, which
// picks the best available system voice for it instead.
const CLOUD_TTS_MAX_CHARS = 4000

// eleven_multilingual_v2's documented language set (ElevenLabs), plus 'en'
// (Groq/Orpheus, no ElevenLabs quota spent) and 'ar' (both providers cover
// it — Groq first, per the API route).
const CLOUD_LANGS = new Set([
  'en',
  'ja',
  'zh',
  'de',
  'hi',
  'fr',
  'ko',
  'pt',
  'it',
  'es',
  'id',
  'nl',
  'tr',
  'fil',
  'tl',
  'pl',
  'sv',
  'bg',
  'ro',
  'ar',
  'cs',
  'el',
  'fi',
  'hr',
  'ms',
  'sk',
  'da',
  'ta',
  'uk',
  'ru'
])

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
