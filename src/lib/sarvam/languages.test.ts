import { describe, it, expect } from 'vitest'
import { toSarvamLanguageCode, supportsBulbul, BULBUL_LANGS } from './languages'

describe('toSarvamLanguageCode', () => {
  it('normalises bare and regional tags to the xx-IN form Sarvam requires', () => {
    expect(toSarvamLanguageCode('hi')).toBe('hi-IN')
    expect(toSarvamLanguageCode('hi-IN')).toBe('hi-IN')
    expect(toSarvamLanguageCode('HI-in')).toBe('hi-IN')
    expect(toSarvamLanguageCode('ta')).toBe('ta-IN')
  })

  it("maps ISO 'or' to Sarvam's 'od' for Odia", () => {
    // Sarvam does not use the ISO-639-1 code here. Sending 'or-IN' is a
    // silent 400, so both spellings have to land on 'od-IN'.
    expect(toSarvamLanguageCode('or')).toBe('od-IN')
    expect(toSarvamLanguageCode('or-IN')).toBe('od-IN')
    expect(toSarvamLanguageCode('od')).toBe('od-IN')
  })

  it('returns null for non-Indian languages, which is the signal to use another provider', () => {
    expect(toSarvamLanguageCode('en')).toBeNull()
    expect(toSarvamLanguageCode('fr')).toBeNull()
    expect(toSarvamLanguageCode('ja')).toBeNull()
    expect(toSarvamLanguageCode('ar')).toBeNull()
  })

  it('handles absent input rather than throwing', () => {
    expect(toSarvamLanguageCode(null)).toBeNull()
    expect(toSarvamLanguageCode(undefined)).toBeNull()
    expect(toSarvamLanguageCode('')).toBeNull()
  })
})

describe('supportsBulbul', () => {
  it('accepts every language Bulbul documents', () => {
    // Guards against the two sets drifting apart: Saaras covers 23
    // languages and Bulbul 11, so "we can transcribe it" must never be
    // assumed to mean "we can speak it".
    for (const code of BULBUL_LANGS) {
      expect(supportsBulbul(code)).toBe(true)
    }
  })

  it('accepts en-IN, which Bulbul supports even though Groq handles English here', () => {
    expect(supportsBulbul('en')).toBe(true)
  })

  it('rejects Indian languages Saaras can transcribe but Bulbul cannot speak', () => {
    // Assamese, Sanskrit, Urdu, Nepali: within Saaras's 23, outside
    // Bulbul's 11.
    expect(supportsBulbul('as')).toBe(false)
    expect(supportsBulbul('sa')).toBe(false)
    expect(supportsBulbul('ur')).toBe(false)
    expect(supportsBulbul('ne')).toBe(false)
  })

  it('rejects non-Indian languages', () => {
    expect(supportsBulbul('fr')).toBe(false)
    expect(supportsBulbul('zh')).toBe(false)
    expect(supportsBulbul(null)).toBe(false)
  })
})
