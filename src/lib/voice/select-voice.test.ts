import { describe, it, expect, vi, afterEach } from 'vitest'
import { detectSpeechLanguage, pickBestVoice } from './select-voice'

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

  it('prefers a network-backed voice over a local one, all else equal', () => {
    const local = voice({ name: 'Local Voice', lang: 'en-US', localService: true })
    const network = voice({ name: 'Network Voice', lang: 'en-US', localService: false })
    expect(pickBestVoice([local, network], 'en-US')).toBe(network)
  })
})
