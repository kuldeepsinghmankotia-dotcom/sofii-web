import { describe, it, expect, vi, beforeEach } from 'vitest'
import dns from 'node:dns/promises'

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn() }
}))

const { fetchPublicUrl } = await import('./url-fetch-guard')

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('fetchPublicUrl - scheme and literal-IP checks', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(fetchPublicUrl('file:///etc/passwd')).rejects.toThrow(/http/i)
  })

  it('rejects a literal loopback IP', async () => {
    await expect(fetchPublicUrl('http://127.0.0.1/')).rejects.toThrow(/not allowed/i)
  })

  it('rejects the cloud metadata address', async () => {
    await expect(fetchPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/not allowed/i)
  })

  it('rejects a private 10.x address', async () => {
    await expect(fetchPublicUrl('http://10.0.0.5/')).rejects.toThrow(/not allowed/i)
  })

  it('rejects a private 192.168.x address', async () => {
    await expect(fetchPublicUrl('http://192.168.1.1/')).rejects.toThrow(/not allowed/i)
  })

  it('rejects localhost by name', async () => {
    await expect(fetchPublicUrl('http://localhost:8000/')).rejects.toThrow(/not allowed/i)
  })

  it('rejects IPv6 loopback', async () => {
    await expect(fetchPublicUrl('http://[::1]/')).rejects.toThrow(/not allowed/i)
  })
})

describe('fetchPublicUrl - DNS-resolved checks', () => {
  it('rejects a hostname that resolves to a private address', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '10.1.2.3', family: 4 }] as never)
    await expect(fetchPublicUrl('http://internal.example.com/')).rejects.toThrow(/not allowed/i)
  })

  it('allows a hostname that resolves to a public address', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    )
    const response = await fetchPublicUrl('http://example.com/')
    expect(response.status).toBe(200)
  })

  it('re-validates redirect targets rather than following blindly', async () => {
    vi.mocked(dns.lookup).mockImplementation(async (hostname: string) => {
      if (hostname === 'redirector.example.com') return [{ address: '93.184.216.34', family: 4 }] as never
      return [{ address: '169.254.169.254', family: 4 }] as never
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://internal.example.com/' } })
      )
    )
    await expect(fetchPublicUrl('http://redirector.example.com/')).rejects.toThrow(/not allowed/i)
  })
})
