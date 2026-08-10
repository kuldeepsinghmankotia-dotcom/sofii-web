// Which Indian languages each Sarvam model actually covers.
//
// Kept apart from the API clients because the two models differ: Saaras
// (speech-to-text) covers 23 languages, Bulbul (text-to-speech) covers 11.
// Routing on the wrong set means either sending a request that 400s, or
// falling back to a worse provider for a language Sarvam handles well.

/**
 * Bulbul's supported `language_code` values, verbatim from
 * docs.sarvam.ai/api-reference/text-to-speech/convert.
 *
 * Note `od-IN` for Odia — Sarvam does not use the ISO-639-1 `or`. Getting
 * this wrong is a silent 400, so the codes are stored exactly as the API
 * expects rather than derived from a locale library.
 */
export const BULBUL_LANGS = new Set([
  'bn-IN',
  'en-IN',
  'gu-IN',
  'hi-IN',
  'kn-IN',
  'ml-IN',
  'mr-IN',
  'od-IN',
  'pa-IN',
  'ta-IN',
  'te-IN'
])

/**
 * The Indic language tags this app can produce from script detection
 * (see lib/voice/select-voice.ts), used to decide whether speech input
 * should go to Saaras rather than Whisper.
 *
 * Deliberately not an attempt to enumerate all 23 of Saaras's languages:
 * we only need to recognise the ones our own detection can emit, and
 * guessing at the full list would mean asserting codes I have not
 * verified. Anything else is sent as `unknown` for Saaras to auto-detect.
 */
export const INDIC_LANGS = new Set([
  'bn-IN',
  'gu-IN',
  'hi-IN',
  'kn-IN',
  'ml-IN',
  'mr-IN',
  'od-IN',
  'pa-IN',
  'ta-IN',
  'te-IN'
])

/**
 * Normalises whatever the app is carrying (`hi`, `hi-IN`, `HI-in`) into
 * the `xx-IN` form Sarvam's APIs require. Returns null for anything that
 * isn't a recognised Indian language, which is the signal to use a
 * different provider.
 */
export function toSarvamLanguageCode(lang: string | null | undefined): string | null {
  if (!lang) return null

  const base = lang.toLowerCase().split('-')[0]
  // `or` is the ISO code a locale library or a browser would hand us;
  // Sarvam wants `od`. Accept both so callers never have to care.
  const normalised = base === 'or' ? 'od' : base
  const candidate = `${normalised}-IN`

  return INDIC_LANGS.has(candidate) ? candidate : null
}

export function supportsBulbul(lang: string | null | undefined): boolean {
  if (!lang) return false
  const base = lang.toLowerCase().split('-')[0]
  const normalised = base === 'or' ? 'od' : base
  return BULBUL_LANGS.has(`${normalised}-IN`)
}
