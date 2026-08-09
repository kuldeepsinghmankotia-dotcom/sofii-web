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

  it('does not support other languages', () => {
    expect(supportsCloudVoice('hi-IN')).toBe(false)
    expect(supportsCloudVoice('zh-CN')).toBe(false)
    expect(supportsCloudVoice('fr-FR')).toBe(false)
  })
})

describe('fetchCloudSpeech', () => {
  it('returns the audio blob on success', async () => {
    const blob = new Blob(['fake-mp3-bytes'], { type: 'audio/mpeg' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })
    )
    const result = await fetchCloudSpeech('hello there')
    expect(result).toBe(blob)
  })

  it('returns null on a non-200 response rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))
    const result = await fetchCloudSpeech('hello there')
    expect(result).toBeNull()
  })

  it('returns null when the request throws (network error) rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await fetchCloudSpeech('hello there')
    expect(result).toBeNull()
  })

  it('truncates text sent to the API at the max char cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob())
    })
    vi.stubGlobal('fetch', fetchMock)

    const longText = 'a'.repeat(5000)
    await fetchCloudSpeech(longText)

    const [, options] = fetchMock.mock.calls[0]
    const body = JSON.parse(options.body) as { text: string }
    expect(body.text.length).toBe(4000)
  })
})
