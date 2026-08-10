import { sarvamRequest } from './client'
import { extensionForMimeType } from '@/lib/voice/recording-format'
import { BULBUL_LANGS, toSarvamLanguageCode } from './languages'

// ---------------------------------------------------------------------------
// Speech-to-text (Saaras)
// ---------------------------------------------------------------------------

const SAARAS_MODEL = 'saaras:v3'

// 'codemix' is the reason to use Saaras at all rather than Whisper: it
// handles sentences that switch between an Indian language and English
// mid-clause ("mujhe kal 5 baje meeting ka reminder set kar do"), which is
// how a very large share of urban India speaks and which Whisper handles
// poorly. The other modes (transcribe/translate/verbatim/translit) are
// deliberately not exposed yet — nothing in the app needs them.
const SAARAS_MODE = 'codemix'

// Sarvam's sentinel for "detect it yourself", per the API reference. Sent
// when we have no confident hint of our own.
export const AUTO_DETECT = 'unknown'

interface SaarasResponse {
  request_id: string
  transcript: string
  language_code: string
  language_probability: number
}

export interface TranscriptionResult {
  text: string
  /** BCP-47 code Saaras detected, e.g. 'hi-IN'. */
  languageCode: string | null
  /** 0–1 confidence in the detected language. */
  languageProbability: number | null
}

/**
 * Transcribe speech with Saaras.
 *
 * `languageHint` should be a confident hint or null — passing a guess is
 * worse than passing nothing, because it overrides the model's own
 * detection. Null becomes `unknown` (auto-detect), which is the right
 * default for a first utterance.
 *
 * Returns null on any failure so the caller can fall back to Whisper.
 */
export async function transcribeWithSaaras(
  audio: ArrayBuffer,
  mimeType: string,
  languageHint: string | null
): Promise<TranscriptionResult | null> {
  const form = new FormData()

  // Filename extension has to match the real container: Safari records MP4
  // where Chrome records WebM, and an .webm name on MP4 bytes makes the API
  // route on the wrong decoder.
  form.append('file', new Blob([audio], { type: mimeType }), `audio.${extensionForMimeType(mimeType)}`)
  form.append('model', SAARAS_MODEL)
  form.append('mode', SAARAS_MODE)
  form.append('language_code', toSarvamLanguageCode(languageHint) ?? AUTO_DETECT)

  const result = await sarvamRequest<SaarasResponse>({ path: '/speech-to-text', body: form })

  if (!result || typeof result.transcript !== 'string') return null

  return {
    text: result.transcript,
    languageCode: result.language_code ?? null,
    languageProbability: typeof result.language_probability === 'number' ? result.language_probability : null
  }
}

// ---------------------------------------------------------------------------
// Text-to-speech (Bulbul)
// ---------------------------------------------------------------------------

// v2 rather than v3 deliberately: v2 is half the price (₹15 vs ₹30 per 10K
// characters) and TTS is the dominant line item in this app's Indic cost
// model — spoken replies are long and frequent, unlike transcription. Move
// to v3 if a blind comparison shows an audible difference worth 2x; that is
// a one-constant change.
const BULBUL_MODEL = 'bulbul:v2'

// v2's default speaker per the API reference. Female, neutral register.
const BULBUL_SPEAKER = 'anushka'

// v2's documented input ceiling is 1500 characters. Enforced here rather
// than relying on a 400, so a long reply degrades to a clean truncation.
export const BULBUL_MAX_CHARS = 1500

interface BulbulResponse {
  request_id: string
  audios: string[]
}

/**
 * Synthesise speech as OGG/Opus, the only audio format WhatsApp accepts for
 * voice notes.
 *
 * Bulbul can emit Ogg/Opus directly, which avoids needing ffmpeg in a
 * serverless function to transcode its WAV — verified against the live API:
 * the bytes come back with an `OggS` magic and an `OpusHead` header.
 *
 * The sample rate is not optional. Opus only permits 8/12/16/24/48 kHz and
 * Bulbul defaults to 22050, so omitting it is a hard 400 rather than a
 * quietly resampled file.
 */
export async function synthesiseOpus(text: string, lang: string): Promise<ArrayBuffer | null> {
  return synthesiseWithBulbul(text, lang, { codec: 'opus', sampleRate: 24000 })
}

/**
 * Synthesise Indic speech with Bulbul.
 *
 * Returns raw audio bytes, or null on any failure (including an unsupported
 * language) so the caller can fall through to the next provider.
 */
export async function synthesiseWithBulbul(
  text: string,
  lang: string,
  options?: { codec?: 'wav' | 'opus'; sampleRate?: number }
): Promise<ArrayBuffer | null> {
  const base = lang.toLowerCase().split('-')[0]
  const languageCode = `${base === 'or' ? 'od' : base}-IN`

  // Bulbul covers 11 languages, fewer than Saaras's 23 — a language we can
  // transcribe is not necessarily one we can speak.
  if (!BULBUL_LANGS.has(languageCode)) return null

  const result = await sarvamRequest<BulbulResponse>({
    path: '/text-to-speech',
    body: {
      text: text.slice(0, BULBUL_MAX_CHARS),
      language_code: languageCode,
      model: BULBUL_MODEL,
      speaker: BULBUL_SPEAKER,
      output_audio_codec: options?.codec ?? 'wav',
      ...(options?.sampleRate ? { speech_sample_rate: options.sampleRate } : {})
    }
  })

  const encoded = result?.audios?.[0]
  if (!encoded) return null

  // Bulbul returns base64 rather than binary audio, unlike Groq and
  // ElevenLabs which stream bytes directly.
  try {
    return Buffer.from(encoded, 'base64').buffer as ArrayBuffer
  } catch (error) {
    console.error('Could not decode Bulbul audio:', error)
    return null
  }
}
