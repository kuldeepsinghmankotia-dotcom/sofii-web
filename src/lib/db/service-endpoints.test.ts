import { describe, it, expect, afterEach } from 'vitest'
import { isUsableIngestUrl } from './service-endpoints'

// The value under test comes out of the database and is then used as the
// destination for a request carrying INGEST_SERVICE_SECRET. Every case here
// is really asking the same question: could this value make the server hand
// that bearer token to somebody else?
describe('isUsableIngestUrl', () => {
  const originalEnv = process.env.INGEST_SERVICE_URL

  afterEach(() => {
    process.env.INGEST_SERVICE_URL = originalEnv
  })

  it('accepts the quick-tunnel hostnames the refresh script produces', () => {
    expect(isUsableIngestUrl('https://feel-suburban-advert-skip.trycloudflare.com')).toBe(true)
    expect(isUsableIngestUrl('https://a-b-c-d.trycloudflare.com/')).toBe(true)
  })

  it('rejects arbitrary hosts, which is the whole point of the allowlist', () => {
    expect(isUsableIngestUrl('https://evil.example.com')).toBe(false)
    expect(isUsableIngestUrl('https://attacker.test/ingest')).toBe(false)
  })

  it('rejects a lookalike host that merely contains the allowed domain', () => {
    // endsWith on the full hostname, not a substring match: these are all
    // controlled by someone else entirely.
    expect(isUsableIngestUrl('https://trycloudflare.com.evil.test')).toBe(false)
    expect(isUsableIngestUrl('https://nottrycloudflare.com')).toBe(false)
    expect(isUsableIngestUrl('https://evil.test/?x=.trycloudflare.com')).toBe(false)
  })

  it('requires https for anything off-loopback, since the secret is in the header', () => {
    expect(isUsableIngestUrl('http://abc.trycloudflare.com')).toBe(false)
  })

  it('allows plain http only on loopback, for local development', () => {
    expect(isUsableIngestUrl('http://localhost:8000')).toBe(true)
    expect(isUsableIngestUrl('http://127.0.0.1:8000')).toBe(true)
  })

  it("allows the configured env var's own host, so a named tunnel still works", () => {
    process.env.INGEST_SERVICE_URL = 'https://ingest.mydomain.com'
    expect(isUsableIngestUrl('https://ingest.mydomain.com')).toBe(true)
    expect(isUsableIngestUrl('https://other.mydomain.com')).toBe(false)
  })

  it('does not widen the allowlist when the env var is malformed', () => {
    process.env.INGEST_SERVICE_URL = 'not a url'
    expect(isUsableIngestUrl('https://evil.example.com')).toBe(false)
  })

  it('rejects non-http schemes and unparseable values', () => {
    expect(isUsableIngestUrl('file:///etc/passwd')).toBe(false)
    expect(isUsableIngestUrl('javascript:alert(1)')).toBe(false)
    expect(isUsableIngestUrl('')).toBe(false)
    expect(isUsableIngestUrl('://')).toBe(false)
  })
})
