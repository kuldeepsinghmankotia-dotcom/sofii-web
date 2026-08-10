import { describe, it, expect } from 'vitest'
import { generateLinkCode, parseLinkCommand } from './linking'

describe('generateLinkCode', () => {
  it('produces a six-character code', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateLinkCode()).toHaveLength(6)
    }
  })

  it('never emits characters that are misread when typed by hand', () => {
    // O/0, I/1, S/5 and Z/2 are excluded: this code is read off a screen and
    // typed into a phone, and a code that fails because someone typed O for
    // 0 teaches the user the feature is broken.
    const forbidden = /[OI0S15Z2]/
    for (let i = 0; i < 500; i++) {
      expect(generateLinkCode()).not.toMatch(forbidden)
    }
  })

  it('does not collapse to a small set of values', () => {
    // A modulo bug or a broken RNG would show up here as heavy repetition.
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) seen.add(generateLinkCode())
    expect(seen.size).toBeGreaterThan(290)
  })
})

describe('parseLinkCommand', () => {
  it('accepts the documented form', () => {
    expect(parseLinkCommand('LINK ABC346')).toBe('ABC346')
  })

  it('accepts a bare code, because people will send just the code', () => {
    expect(parseLinkCommand('ABC346')).toBe('ABC346')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(parseLinkCommand('  link abc346  ')).toBe('ABC346')
    expect(parseLinkCommand('Link Abc346')).toBe('ABC346')
  })

  it('does not mistake ordinary messages for codes', () => {
    // This is the case that matters: a false positive would swallow a real
    // message and answer it with a linking error instead.
    expect(parseLinkCommand('hello')).toBeNull()
    expect(parseLinkCommand('what is the weather today')).toBeNull()
    expect(parseLinkCommand('remind me at 5')).toBeNull()
    expect(parseLinkCommand('')).toBeNull()
  })

  it('rejects six-letter words made of excluded characters', () => {
    // 'PLEASE' contains S and E; S is not in the alphabet, so it cannot be
    // a code even though it is six characters.
    expect(parseLinkCommand('PLEASE')).toBeNull()
    expect(parseLinkCommand('STATUS')).toBeNull()
  })

  it('rejects codes of the wrong length', () => {
    expect(parseLinkCommand('ABC34')).toBeNull()
    expect(parseLinkCommand('ABC3467')).toBeNull()
  })

  it('accepts a real six-letter word that happens to be valid', () => {
    // Honest about the trade-off: 'BUTTER' is entirely within the alphabet,
    // so it parses as a code and will simply fail to redeem. Failing that
    // way is fine; the alternative (requiring the LINK prefix) loses more
    // users than it protects.
    expect(parseLinkCommand('BUTTER')).toBe('BUTTER')
  })
})
