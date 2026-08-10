import { describe, it, expect, vi, afterEach } from 'vitest'
import { pickRecordingMimeType, baseMimeType, extensionForMimeType } from './recording-format'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pickRecordingMimeType', () => {
  it('prefers opus webm where it is supported (Chrome, Firefox)', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (t: string) => t.startsWith('audio/webm') })
    expect(pickRecordingMimeType()).toBe('audio/webm;codecs=opus')
  })

  it('falls back to mp4 on Safari, which cannot record webm at all', () => {
    // The bug this exists for: passing an unsupported mimeType makes the
    // MediaRecorder constructor throw, so hardcoding webm meant voice input
    // never started on iPhone — no prompt, no recording, tap or hold alike.
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (t: string) => t.startsWith('audio/mp4') })
    expect(pickRecordingMimeType()).toBe('audio/mp4;codecs=mp4a.40.2')
  })

  it('returns null when nothing matches, so the browser picks its own default', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => false })
    expect(pickRecordingMimeType()).toBeNull()
  })

  it('returns null when isTypeSupported is missing, as on older Safari', () => {
    vi.stubGlobal('MediaRecorder', {})
    expect(pickRecordingMimeType()).toBeNull()
  })

  it('returns null when MediaRecorder is absent entirely (SSR)', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    expect(pickRecordingMimeType()).toBeNull()
  })
})

describe('baseMimeType', () => {
  it('strips codec parameters, which some upload endpoints reject', () => {
    expect(baseMimeType('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(baseMimeType('audio/mp4;codecs=mp4a.40.2')).toBe('audio/mp4')
  })

  it('passes a bare type through', () => {
    expect(baseMimeType('audio/mp4')).toBe('audio/mp4')
  })

  it('falls back when the recorder reports nothing', () => {
    expect(baseMimeType(undefined)).toBe('audio/webm')
    expect(baseMimeType('')).toBe('audio/webm')
    expect(baseMimeType(null)).toBe('audio/webm')
  })
})

describe('extensionForMimeType', () => {
  it('maps each recordable container to the extension speech APIs expect', () => {
    // Safari records mp4; naming those bytes .webm makes the API route on
    // the wrong decoder.
    expect(extensionForMimeType('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
    expect(extensionForMimeType('audio/webm;codecs=opus')).toBe('webm')
    expect(extensionForMimeType('audio/wav')).toBe('wav')
    expect(extensionForMimeType('audio/ogg;codecs=opus')).toBe('ogg')
  })

  it('defaults to webm for anything unrecognised', () => {
    expect(extensionForMimeType('audio/weird')).toBe('webm')
    expect(extensionForMimeType(undefined)).toBe('webm')
  })
})
