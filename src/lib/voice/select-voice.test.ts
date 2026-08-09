import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  detectConfidentScriptLanguage,
  detectScriptLanguage,
  detectSpeechLanguage,
  keepSpeechAlive,
  pickBestVoice,
  stripEmojisForSpeech
} from './select-voice'

function voice(overrides: Partial<SpeechSynthesisVoice>): SpeechSynthesisVoice {
  return {
    name: 'Test Voice',
    lang: 'en-US',
    default: false,
    localService: true,
    voiceURI: 'test',
    ...overrides
  } as SpeechSynthesisVoice
}

describe('detectSpeechLanguage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('detects Chinese script', () => {
    expect(detectSpeechLanguage('你好，今天天气怎么样？')).toBe('zh-CN')
  })

  it('detects Japanese script', () => {
    expect(detectSpeechLanguage('こんにちは、元気ですか？')).toBe('ja-JP')
  })

  it('detects Korean script', () => {
    expect(detectSpeechLanguage('안녕하세요, 오늘 어때요?')).toBe('ko-KR')
  })

  it('detects Arabic script', () => {
    expect(detectSpeechLanguage('مرحبا كيف حالك اليوم')).toBe('ar-SA')
  })

  it('detects Cyrillic script', () => {
    expect(detectSpeechLanguage('Привет, как дела сегодня')).toBe('ru-RU')
  })

  it('falls back to navigator.language for Latin-script text', () => {
    vi.stubGlobal('navigator', { language: 'fr-FR' })
    expect(detectSpeechLanguage('Bonjour, comment allez-vous?')).toBe('fr-FR')
  })

  it('falls back to en-US when navigator.language is unavailable', () => {
    vi.stubGlobal('navigator', {})
    expect(detectSpeechLanguage('Hello there')).toBe('en-US')
  })
})

describe('stripEmojisForSpeech', () => {
  // Every emoji test constant below is built via String.fromCodePoint
  // rather than embedded as a literal glyph in this file — same reasoning
  // as select-voice.ts's own ZWJ_CODE_POINT/VARIATION_SELECTOR_16_CODE_POINT
  // constants: an actual emoji character (and especially a ZWJ/variation
  // selector inside a compound one) is effectively invisible in a diff.
  const WAVE = String.fromCodePoint(0x1f44b) // 👋
  const CHECK = String.fromCodePoint(0x2705) // ✅
  const ROCKET = String.fromCodePoint(0x1f680) // 🚀
  const SMILE = String.fromCodePoint(0x1f60a) // 😊
  const THUMBS_UP = String.fromCodePoint(0x1f44d) // 👍

  it('strips a simple trailing emoji', () => {
    expect(stripEmojisForSpeech(`Hi there! ${WAVE}`)).toBe('Hi there!')
  })

  it('strips multiple emoji throughout a sentence', () => {
    expect(stripEmojisForSpeech(`${CHECK} Great job! Keep it up. ${ROCKET}`)).toBe(
      'Great job! Keep it up.'
    )
  })

  it('strips a ZWJ compound emoji (family/skin-tone sequences) entirely', () => {
    // U+1F468 U+200D U+1F469 U+200D U+1F467 - man+ZWJ+woman+ZWJ+girl "family"
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)
    expect(stripEmojisForSpeech(`Family time ${family} today`)).toBe('Family time today')
  })

  it('strips flag emoji (regional indicator pairs)', () => {
    // U+1F1FA U+1F1F8 - regional indicators "U" + "S" = US flag
    const usFlag = String.fromCodePoint(0x1f1fa, 0x1f1f8)
    expect(stripEmojisForSpeech(`Shipping to ${usFlag} only`)).toBe('Shipping to only')
  })

  it('leaves plain punctuation and markdown untouched', () => {
    const text = 'Here is a **bold** point, and a list:\n- one\n- two'
    expect(stripEmojisForSpeech(text)).toBe(text)
  })

  it('returns an empty string when the text is emoji-only', () => {
    expect(stripEmojisForSpeech(THUMBS_UP)).toBe('')
  })

  it('collapses the double space left behind after removing a mid-sentence emoji', () => {
    expect(stripEmojisForSpeech(`Sounds good ${SMILE} see you soon!`)).toBe(
      'Sounds good see you soon!'
    )
  })
})

describe('detectScriptLanguage', () => {
  it('detects Devanagari (Hindi) script confidently', () => {
    expect(detectScriptLanguage('नमस्ते, आप कैसे हैं?')).toBe('hi-IN')
  })

  it('returns null for Latin-script text rather than guessing', () => {
    expect(detectScriptLanguage('Hello, how are you?')).toBeNull()
  })

  it('never confuses Hindi (Devanagari) with Chinese', () => {
    // The actual reported bug: spoken Hindi ended up hinted/voiced as
    // Chinese. Devanagari and CJK Unified Ideographs are disjoint Unicode
    // blocks, so this should never happen from this function's own logic -
    // guards against a future SCRIPT_RANGES edit reintroducing overlap.
    expect(detectScriptLanguage('नमस्ते')).not.toBe('zh-CN')
  })

  it('matches on a single stray character - deliberately loose, see detectConfidentScriptLanguage', () => {
    expect(detectScriptLanguage('Hello, my friend ا')).toBe('ar-SA')
  })
})

describe('detectConfidentScriptLanguage', () => {
  it('confirms a real, mostly-Hindi sentence', () => {
    expect(detectConfidentScriptLanguage('नमस्ते, आप कैसे हैं?')).toBe('hi-IN')
  })

  it('does not lock in a language from one stray character in an otherwise English sentence', () => {
    // The actual reported regression: a single incidental Arabic-range
    // character in a transcription (a Whisper artifact) locked the
    // per-conversation hint to Arabic, which then forced every later
    // turn - in whatever language was actually spoken - to be
    // transcribed (and therefore replied to) in Arabic too.
    expect(detectConfidentScriptLanguage('Hello, my friend ا')).toBeNull()
  })

  it('returns null for plain Latin-script text', () => {
    expect(detectConfidentScriptLanguage('Hello, how are you?')).toBeNull()
  })

  it('returns null for empty text', () => {
    expect(detectConfidentScriptLanguage('')).toBeNull()
  })

  it('confirms a real, mostly-Arabic sentence (not just any Arabic text)', () => {
    expect(detectConfidentScriptLanguage('مرحبا كيف حالك اليوم')).toBe('ar-SA')
  })
})

describe('pickBestVoice', () => {
  it('returns null for an empty voice list', () => {
    expect(pickBestVoice([], 'en-US')).toBeNull()
  })

  it('prefers an exact language match over a same-family match', () => {
    const british = voice({ name: 'British', lang: 'en-GB' })
    const american = voice({ name: 'American', lang: 'en-US' })
    expect(pickBestVoice([british, american], 'en-US')).toBe(american)
  })

  it('falls back to a same-family match when no exact match exists', () => {
    const british = voice({ name: 'British', lang: 'en-GB' })
    expect(pickBestVoice([british], 'en-US')).toBe(british)
  })

  it('never picks a voice in a completely different language', () => {
    const spanish = voice({ name: 'Spanish', lang: 'es-ES' })
    expect(pickBestVoice([spanish], 'en-US')).toBeNull()
  })

  it('prefers a higher-quality-sounding named voice over a plain one', () => {
    const plain = voice({ name: 'Plain Voice', lang: 'en-US' })
    const enhanced = voice({ name: 'Samantha (Enhanced)', lang: 'en-US' })
    expect(pickBestVoice([plain, enhanced], 'en-US')).toBe(enhanced)
  })

  it('prefers a local (low-latency) voice over a network-backed one, all else equal', () => {
    const local = voice({ name: 'Local Voice', lang: 'en-US', localService: true })
    const network = voice({ name: 'Network Voice', lang: 'en-US', localService: false })
    expect(pickBestVoice([local, network], 'en-US')).toBe(local)
  })

  it('still picks a network voice over no voice at all when nothing local matches', () => {
    const network = voice({ name: 'Network Voice', lang: 'hi-IN', localService: false })
    expect(pickBestVoice([network], 'hi-IN')).toBe(network)
  })

  it('prefers a curated warm-sounding voice over a plain default voice', () => {
    const plain = voice({ name: 'Albert', lang: 'en-US', default: true })
    const curated = voice({ name: 'Samantha', lang: 'en-US', default: false })
    expect(pickBestVoice([plain, curated], 'en-US')).toBe(curated)
  })

  it('respects curated-list order between two curated voices', () => {
    // 'ava' is listed before 'samantha' in CURATED_VOICE_NAMES.
    const samantha = voice({ name: 'Samantha', lang: 'en-US' })
    const ava = voice({ name: 'Ava', lang: 'en-US' })
    expect(pickBestVoice([samantha, ava], 'en-US')).toBe(ava)
  })

  it('prefers a curated local voice over an uncurated network voice', () => {
    const network = voice({ name: 'Google US English', lang: 'en-US', localService: false })
    const curatedLocal = voice({ name: 'Samantha', lang: 'en-US', localService: true })
    expect(pickBestVoice([network, curatedLocal], 'en-US')).toBe(curatedLocal)
  })
})

describe('keepSpeechAlive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('pauses and resumes speechSynthesis while speaking, on an interval', () => {
    const pause = vi.fn()
    const resume = vi.fn()
    vi.stubGlobal('window', {
      speechSynthesis: { speaking: true, pause, resume },
      setInterval,
      clearInterval
    })

    const stop = keepSpeechAlive()
    vi.advanceTimersByTime(10_000)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10_000)
    expect(pause).toHaveBeenCalledTimes(2)

    stop()
    vi.advanceTimersByTime(30_000)
    expect(pause).toHaveBeenCalledTimes(2) // no further calls after stop()
  })

  it('does not pause/resume once speech has already finished', () => {
    const pause = vi.fn()
    const resume = vi.fn()
    vi.stubGlobal('window', {
      speechSynthesis: { speaking: false, pause, resume },
      setInterval,
      clearInterval
    })

    keepSpeechAlive()
    vi.advanceTimersByTime(10_000)
    expect(pause).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
  })
})
