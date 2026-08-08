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

export function detectSpeechLanguage(text: string): string {
  for (const { lang, pattern } of SCRIPT_RANGES) {
    if (pattern.test(text)) return lang
  }
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US'
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

const PREFERRED_NAME_HINTS = ['natural', 'enhanced', 'premium', 'neural', 'google']

function baseLang(tag: string): string {
  return tag.split('-')[0].toLowerCase()
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

    if (PREFERRED_NAME_HINTS.some((hint) => voice.name.toLowerCase().includes(hint))) score += 20
    // Network-backed voices are usually the higher-quality ones (vs. the
    // always-available compact/offline voice) where a browser offers both.
    if (!voice.localService) score += 10
    if (voice.default) score += 5

    if (score > bestScore) {
      bestScore = score
      best = voice
    }
  }

  return best
}
