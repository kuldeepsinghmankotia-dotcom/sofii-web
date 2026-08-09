import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { detectScriptLanguage, detectSpeechLanguage, keepSpeechAlive, pickBestVoice } from './select-voice'

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
