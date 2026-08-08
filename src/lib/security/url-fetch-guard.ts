import dns from 'node:dns/promises'
import net from 'node:net'

// Fetching a user-supplied URL server-side (URL ingestion) is a classic
// SSRF vector: without this, a user could point it at 127.0.0.1, this
// deployment's own internal services, a cloud metadata endpoint
// (169.254.169.254), or any other address only reachable from inside
// Vercel's network. This validates both scheme and resolved IP before any
// fetch happens, and every redirect hop gets re-validated too (see
// fetchPublicUrl below) rather than trusting the destination just because
// the original URL passed.
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal'])

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fe80:')) return true // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local, fc00::/7
  if (lower.startsWith('::ffff:')) {
    const embedded = lower.split(':').pop() ?? ''
    if (net.isIPv4(embedded)) return isPrivateIPv4(embedded)
  }
  return false
}

async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Not a valid URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported.')
  }

  // WHATWG URL.hostname keeps surrounding brackets for IPv6 literals
  // (e.g. "[::1]") — net.isIP/isIPv4/isIPv6 don't recognize that syntax,
  // which would otherwise make a literal IPv6 address silently fall
  // through to the DNS-lookup branch below instead of being checked
  // directly.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('This URL is not allowed.')
  }

  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname)) {
      throw new Error('This URL is not allowed.')
    }
    return url
  }

  let addresses: { address: string; family: number }[]
  try {
    addresses = await dns.lookup(hostname, { all: true })
  } catch {
    throw new Error("Could not resolve this URL's host.")
  }

  if (addresses.length === 0) throw new Error("Could not resolve this URL's host.")

  for (const { address, family } of addresses) {
    const blocked = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address)
    if (blocked) throw new Error('This URL is not allowed.')
  }

  return url
}

const MAX_REDIRECTS = 3

// redirect: 'manual' + re-validating every hop closes the DNS-rebinding-
// style gap a naive fetch(url, {redirect: 'follow'}) would leave open — a
// URL that passes the check but 302s to an internal address would
// otherwise be followed automatically without ever being re-checked.
export async function fetchPublicUrl(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let currentUrl = rawUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const validated = await assertPublicHttpUrl(currentUrl)
    const response = await fetch(validated, { ...init, redirect: 'manual' })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return response
      currentUrl = new URL(location, validated).toString()
      continue
    }

    return response
  }

  throw new Error('Too many redirects.')
}
