import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchCloudSpeech, supportsCloudVoice } from './cloud-tts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('supportsCloudVoice', () => {
  it('supports English variants', () => {
    expect(supportsCloudVoice('en-US')).toBe(true)
    expect(supportsCloudVoice('en-GB')).toBe(true)
    expect(supportsCloudVoice('en')).toBe(true)
  })

  it('supports Arabic', () => {
    expect(supportsCloudVoice('ar-SA')).toBe(true)
  })

  it('supports the broader ElevenLabs-covered languages', () => {
    expect(supportsCloudVoice('hi-IN')).toBe(true)
    expect(supportsCloudVoice('zh-CN')).toBe(true)
    expect(supportsCloudVoice('fr-FR')).toBe(true)
    expect(supportsCloudVoice('ru-RU')).toBe(true)
  })

  it('does not support a language neither provider covers', () => {
    expect(supportsCloudVoice('sw-KE')).toBe(false) // Swahili
    expect(supportsCloudVoice('xx')).toBe(false)
  })
})

describe('fetchCloudSpeech', () => {
  it('returns the audio blob on success', async () => {
    const blob = new Blob(['fake-wav-bytes'], { type: 'audio/wav' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })
    )
    const result = await fetchCloudSpeech('hello there', 'en-US')
    expect(result).toBe(blob)
  })

  it('returns null on a non-200 response rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))
    const result = await fetchCloudSpeech('hello there', 'en-US')
    expect(result).toBeNull()
  })

  it('returns null when the request throws (network error) rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await fetchCloudSpeech('hello there', 'en-US')
    expect(result).toBeNull()
  })

  it('truncates text sent to the API at the max char cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob())
    })
    vi.stubGlobal('fetch', fetchMock)

    const longText = 'a'.repeat(5000)
    await fetchCloudSpeech(longText, 'en-US')

    const [, options] = fetchMock.mock.calls[0]
    const body = JSON.parse(options.body) as { text: string; lang: string }
    expect(body.text.length).toBe(4000)
  })

  it('sends the base language code, not the full BCP-47 tag', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob())
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchCloudSpeech('hello there', 'en-GB')

    const [, options] = fetchMock.mock.calls[0]
    const body = JSON.parse(options.body) as { text: string; lang: string }
    expect(body.lang).toBe('en')
  })
})
