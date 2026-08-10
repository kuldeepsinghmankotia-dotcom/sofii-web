import { createHmac, timingSafeEqual } from 'crypto'

// Meta signs every webhook POST with HMAC-SHA256 over the raw request body,
// keyed with the app secret, and sends it as `X-Hub-Signature-256:
// sha256=<hex>`.
//
// This endpoint is publicly reachable and anything it accepts is treated as
// a message from a real user — it can start conversations, spend model
// quota, and read back a user's memories. An unverified webhook is an open
// door to all of that, so verification is mandatory rather than defensive.

const SIGNATURE_PREFIX = 'sha256='

/**
 * Verify a webhook signature.
 *
 * `rawBody` must be the exact bytes Meta sent. Parsing JSON and
 * re-serialising it changes key order and whitespace, which changes the
 * hash — the caller has to read the body as text and hand the same string
 * to both this function and the JSON parser.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) return false
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return false

  const received = signatureHeader.slice(SIGNATURE_PREFIX.length)
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')

  // timingSafeEqual throws on a length mismatch, so the lengths are compared
  // first — that comparison leaks only the length, which is fixed for
  // sha256 hex anyway.
  if (received.length !== expected.length) return false

  try {
    return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    // Non-hex input reaches here rather than throwing out of the route.
    return false
  }
}

/**
 * The GET handshake Meta performs once when the webhook URL is saved.
 *
 * Returns the challenge to echo back, or null to reject. The token is
 * ours — it is set in both the Meta dashboard and this app's env — and
 * proves the request came from a dashboard configured by us rather than
 * from anyone who guessed the URL.
 */
export function resolveVerificationChallenge(
  params: URLSearchParams,
  expectedToken: string
): string | null {
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  if (mode !== 'subscribe' || !token || !challenge || !expectedToken) return null

  // Compared in constant time for the same reason as the signature: this is
  // a shared secret, and a fast reject leaks how much of it was right.
  const a = Buffer.from(token)
  const b = Buffer.from(expectedToken)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null

  return challenge
}
