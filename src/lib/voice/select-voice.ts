// Sofii's spoken replies previously used `new SpeechSynthesisUtterance(text)`
// with no `voice`/`lang` ever set — meaning every reply, in every language,
// played through whatever the browser's own unnamed default happened to be
// (often the flattest/most robotic voice installed, and never
// language-matched, so anything past ASCII English got mispronounced in
// whatever the default voice's language was). This picks an actual voice:
// language-matched to what's being spoken, preferring the higher-quality
// voices browsers expose alongside their compact/offline default.

// Script-range detection, not a language-ID model: cheap, no new
// dependency, and it's enough to route CJK/Arabic/Cyrillic/Devanagari/etc.
// replies to a voice that can actually pronounce them instead of the
// browser's English default mangling them. Latin-script text (the large
// majority of European languages) falls through to the browser/OS's own
// locale below — a real language-ID model would be needed to tell French
// from Spanish from raw characters alone, which isn't worth a new
// dependency for a "best effort" voice pick.
const SCRIPT_RANGES: { lang: string; pattern: RegExp }[] = [
  // Japanese must be checked before Chinese: real Japanese text is nearly
  // always a mix of Hiragana/Katakana (unique to Japanese) and Kanji (the
  // same CJK Unified Ideographs block Chinese uses) — checking the generic
  // CJK ideograph range first would misclassify any Kanji-containing
  // Japanese sentence as Chinese, which is most of them. Caught by a real
  // test failure: "こんにちは、元気ですか？" (contains 元気) matched zh-CN
  // until this was reordered.
  { lang: 'ja-JP', pattern: /[぀-ヿ]/ },
  { lang: 'zh-CN', pattern: /[一-鿿]/ },
  { lang: 'ko-KR', pattern: /[가-힯]/ },
  { lang: 'ar-SA', pattern: /[؀-ۿ]/ },
  { lang: 'ru-RU', pattern: /[Ѐ-ӿ]/ },
  { lang: 'hi-IN', pattern: /[ऀ-ॿ]/ },
  { lang: 'th-TH', pattern: /[฀-๿]/ },
  { lang: 'he-IL', pattern: /[֐-׿]/ },
  { lang: 'el-GR', pattern: /[Ͱ-Ͽ]/ }
]

// Script evidence only, no locale fallback — returns null rather than
// guessing when text is Latin-script (ambiguous: could be English, French,
// Spanish, ...). Used to build a *confident* per-conversation language
// hint for speech-to-text (see chat-window.tsx's speechLangHintRef); a
// fallback guess would be actively worse there, since a wrong hint passed
// to Whisper actively degrades transcription instead of just picking a
// mediocre voice.
export function detectScriptLanguage(text: string): string | null {
  for (const { lang, pattern } of SCRIPT_RANGES) {
    if (pattern.test(text)) return lang
  }
  return null
}

// Emoji read literally by a TTS engine reads as broken, not expressive —
// most either announce the Unicode name ("waving hand emoji") or garble an
// attempt at pronouncing it. Stripped before either speech path (cloud or
// browser) ever sees the text; markdown and normal punctuation are left
// untouched, this only targets actual pictographic code points. Written
// entirely with \u escapes rather than literal invisible characters
// (zero-width joiner, variation selector) in the source — those are
// impossible to visually verify in a diff/review otherwise.
// Built via String.fromCodePoint rather than embedding the zero-width
// joiner / variation-selector-16 characters directly in a regex literal —
// those specific code points are invisible and impossible to tell apart
// from a plain empty match at a glance in a diff, so this spells them out
// in plain ASCII (ZWJ_CODE_POINT/VARIATION_SELECTOR_16_CODE_POINT) instead.
const ZWJ_CODE_POINT = 0x200d
const VARIATION_SELECTOR_16_CODE_POINT = 0xfe0f
const zwjEmojiSequence = new RegExp(
  `\\p{Extended_Pictographic}(${String.fromCodePoint(ZWJ_CODE_POINT)}\\p{Extended_Pictographic})*`,
  'gu'
)
const regionalIndicatorFlagPair = /[\u{1F1E6}-\u{1F1FF}]{2}/gu
const danglingVariationSelector = new RegExp(String.fromCodePoint(VARIATION_SELECTOR_16_CODE_POINT), 'g')

export function stripEmojisForSpeech(text: string): string {
  return text
    .replace(zwjEmojiSequence, '')
    .replace(regionalIndicatorFlagPair, '')
    .replace(danglingVariationSelector, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function detectSpeechLanguage(text: string): string {
  return (
    detectScriptLanguage(text) ??
    (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US')
  )
}

// Chrome in particular returns an empty voice list on the very first call —
// getVoices() only populates after the async 'voiceschanged' event fires,
// especially on a cold page load before the speech engine has enumerated
// anything. Resolves immediately if voices are already there.
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices()
    if (existing.length > 0) {
      resolve(existing)
      return
    }
    const onVoicesChanged = (): void => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged)
    // Some browsers (older WebKit) never fire voiceschanged reliably — this
    // ensures the caller isn't left hanging forever on those.
    window.setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged)
      resolve(window.speechSynthesis.getVoices())
    }, 1000)
  })
}

const PREFERRED_NAME_HINTS = ['natural', 'enhanced', 'premium', 'neural']

// Specific voices known to read as warm/pleasant rather than flat or
// robotic, checked ahead of the generic hints above — this is what
// actually changes which voice gets picked among several that all
// technically match the target language (e.g. preferring "Samantha" over
// an OS's arbitrary picked-by-nothing default like "Rishi"/"Albert").
// Ordered by preference; first match in the list wins over a later one.
// Deliberately local/on-device voices only (Apple/Microsoft system
// voices) — a "Google ..." network voice used to sit at the top of this
// list, which meant it got picked over an equally fine on-device voice
// purely for being named "Google", adding real network round-trip latency
// (send text to Google's TTS servers, stream audio back) before speech
// could even start. That's real, reported lag, not a quality trade worth
// making by default — see the localService scoring below.
const CURATED_VOICE_NAMES = ['ava', 'samantha', 'zoe', 'serena', 'aria', 'jenny', 'nicky']

function baseLang(tag: string): string {
  return tag.split('-')[0].toLowerCase()
}

function curatedRank(name: string): number {
  const lower = name.toLowerCase()
  const index = CURATED_VOICE_NAMES.findIndex((curated) => lower.includes(curated))
  // Higher is better, same direction as the rest of this function's
  // scoring — a curated match beats every generic-hint/network/default
  // point combined (at most ~35) without needing them to also line up.
  return index === -1 ? 0 : (CURATED_VOICE_NAMES.length - index) * 10
}

// Scoring, not a strict filter: an exact "en-US" match beats a same-family
// "en-GB" voice, which beats nothing at all — but there's always a
// best-available fallback rather than silently speaking in the wrong
// language when the exact locale isn't installed.
export function pickBestVoice(
  voices: SpeechSynthesisVoice[],
  targetLang: string
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null

  const target = targetLang.toLowerCase()
  const targetBase = baseLang(targetLang)

  let best: SpeechSynthesisVoice | null = null
  let bestScore = -1

  for (const voice of voices) {
    const voiceLang = voice.lang.toLowerCase()
    let score = 0

    if (voiceLang === target) score += 100
    else if (baseLang(voice.lang) === targetBase) score += 50
    else continue // wrong language entirely - never picked over "no match"

    score += curatedRank(voice.name)
    if (PREFERRED_NAME_HINTS.some((hint) => voice.name.toLowerCase().includes(hint))) score += 20
    // On-device voices start speaking immediately; a network-backed voice
    // (Chrome's "Google ..." voices in particular) has to round-trip text
    // to a remote TTS server and stream audio back before anything plays —
    // real, noticeable latency, reported as "lag" for exactly the
    // languages that often only have a network voice installed at all.
    // Prefer local when there's a genuine choice; a network voice still
    // wins over no voice in that language whatsoever.
    if (voice.localService) score += 15
    if (voice.default) score += 5

    if (score > bestScore) {
      bestScore = score
      best = voice
    }
  }

  return best
}

// A default rate of 1.0 with no pitch adjustment reads as flat and a
// little rushed for a conversational assistant — most native TTS engines
// are tuned for narration speed, not a warm back-and-forth. Slightly
// slower and a touch higher reads as calmer and more attentive without
// sliding into "obviously slowed down."
export const SPEECH_RATE = 0.93
export const SPEECH_PITCH = 1.05

const KEEP_ALIVE_INTERVAL_MS = 10_000

// Chrome has a long-standing, never-fixed bug where speechSynthesis stalls
// or cuts an utterance off partway through on anything longer than
// roughly 15 seconds of audio — exactly what "the voice is lagging"
// reports as, and exactly what a multi-sentence assistant reply runs into
// routinely. Periodically pausing and immediately resuming resets the
// engine's internal timer and is the standard, documented workaround.
// Harmless on browsers without the bug: pausing/resuming an utterance
// that was never going to stall just costs a no-op interval tick.
export function keepSpeechAlive(): () => void {
  const interval = window.setInterval(() => {
    if (!window.speechSynthesis.speaking) return
    window.speechSynthesis.pause()
    window.speechSynthesis.resume()
  }, KEEP_ALIVE_INTERVAL_MS)
  return () => window.clearInterval(interval)
}
