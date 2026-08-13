import { describe, it, expect } from 'vitest'
import { containsWakeWord, newTranscript } from './wake-word'

const result = (transcript: string) => ({ 0: { transcript } })

describe('containsWakeWord', () => {
  it('triggers on the name and its likely mishearings', () => {
    for (const said of ['Sofii', 'sofi', 'Hey Sophie', 'sofia are you there', 'Sophia']) {
      expect(containsWakeWord(said)).toBe(true)
    }
  })

  it('does not trigger on words that merely contain the letters', () => {
    // The original substring test fired on all of these. With speech being
    // transcribed continuously, that is how the microphone came to open by
    // itself.
    expect(containsWakeWord('sofia-like philosophies')).toBe(true) // 'sofia' is a real word here
    expect(containsWakeWord('philosophies')).toBe(false)
    expect(containsWakeWord('sofisticated')).toBe(false)
    expect(containsWakeWord('unsofistical')).toBe(false)
  })

  it('ignores ordinary conversation', () => {
    expect(containsWakeWord('can you pass me the salt')).toBe(false)
    expect(containsWakeWord('the sofa is comfortable')).toBe(false)
    expect(containsWakeWord('')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(containsWakeWord('SOFII')).toBe(true)
  })
})

describe('newTranscript', () => {
  it('returns only what arrived in this event', () => {
    // The bug: results is cumulative in continuous mode, so reading all of
    // it meant a mishearing from a minute ago kept matching forever, and the
    // microphone reopened with nobody having spoken.
    const event = {
      results: [result('sofii'), result('some later chatter'), result('and more')],
      resultIndex: 1
    }
    expect(newTranscript(event)).toBe('some later chatter and more')
    expect(containsWakeWord(newTranscript(event))).toBe(false)
  })

  it('still sees the wake word when it is the new part', () => {
    const event = { results: [result('earlier talk'), result('sofii')], resultIndex: 1 }
    expect(containsWakeWord(newTranscript(event))).toBe(true)
  })

  it('reads everything when resultIndex is absent', () => {
    expect(newTranscript({ results: [result('sofii')] })).toBe('sofii')
  })

  it('handles an empty result list', () => {
    expect(newTranscript({ results: [], resultIndex: 0 })).toBe('')
  })
})
