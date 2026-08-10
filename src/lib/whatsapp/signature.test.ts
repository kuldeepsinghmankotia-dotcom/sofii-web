import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifyWebhookSignature, resolveVerificationChallenge } from './signature'

const SECRET = 'test-app-secret'
const sign = (body: string, secret = SECRET): string =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })

  it('accepts a correctly signed body', () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true)
  })

  it('rejects a body that was tampered with after signing', () => {
    // The whole point: this endpoint acts on whatever it accepts, spending
    // model quota and reading a user's memories.
    const signature = sign(body)
    expect(verifyWebhookSignature(body + ' ', signature, SECRET)).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    expect(verifyWebhookSignature(body, sign(body, 'wrong-secret'), SECRET)).toBe(false)
  })

  it('rejects a missing or malformed header', () => {
    expect(verifyWebhookSignature(body, null, SECRET)).toBe(false)
    expect(verifyWebhookSignature(body, '', SECRET)).toBe(false)
    // No sha256= prefix.
    expect(verifyWebhookSignature(body, createHmac('sha256', SECRET).update(body).digest('hex'), SECRET)).toBe(false)
    // Right prefix, wrong algorithm label.
    expect(verifyWebhookSignature(body, `sha1=${'a'.repeat(40)}`, SECRET)).toBe(false)
  })

  it('rejects rather than throwing on non-hex input', () => {
    // An exception escaping the route would return a 500, which Meta reads
    // as "retry", turning a malformed request into a redelivery loop.
    expect(verifyWebhookSignature(body, `sha256=${'z'.repeat(64)}`, SECRET)).toBe(false)
    expect(verifyWebhookSignature(body, 'sha256=not-hex-at-all', SECRET)).toBe(false)
  })

  it('rejects when no secret is configured, rather than accepting everything', () => {
    // The dangerous failure mode: treating an absent secret as "skip
    // verification" would leave the endpoint wide open the moment an env
    // var goes missing.
    expect(verifyWebhookSignature(body, sign(body), '')).toBe(false)
  })

  it('handles a body with unicode, where byte length differs from string length', () => {
    const unicode = JSON.stringify({ text: 'नमस्ते, आप कैसे हैं?' })
    expect(verifyWebhookSignature(unicode, sign(unicode), SECRET)).toBe(true)
  })
})

describe('resolveVerificationChallenge', () => {
  const TOKEN = 'my-verify-token'
  const params = (o: Record<string, string>): URLSearchParams => new URLSearchParams(o)

  it('echoes the challenge when mode and token are right', () => {
    const result = resolveVerificationChallenge(
      params({ 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '12345' }),
      TOKEN
    )
    expect(result).toBe('12345')
  })

  it('rejects a wrong token', () => {
    expect(
      resolveVerificationChallenge(
        params({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '12345' }),
        TOKEN
      )
    ).toBeNull()
  })

  it('rejects a token of a different length without throwing', () => {
    // timingSafeEqual throws on length mismatch; the length is compared
    // first so this returns cleanly.
    expect(
      resolveVerificationChallenge(
        params({ 'hub.mode': 'subscribe', 'hub.verify_token': 'short', 'hub.challenge': '1' }),
        TOKEN
      )
    ).toBeNull()
  })

  it('rejects a mode other than subscribe', () => {
    expect(
      resolveVerificationChallenge(
        params({ 'hub.mode': 'unsubscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '1' }),
        TOKEN
      )
    ).toBeNull()
  })

  it('rejects when any parameter is missing', () => {
    expect(resolveVerificationChallenge(params({ 'hub.mode': 'subscribe' }), TOKEN)).toBeNull()
    expect(
      resolveVerificationChallenge(params({ 'hub.verify_token': TOKEN, 'hub.challenge': '1' }), TOKEN)
    ).toBeNull()
  })

  it('rejects when no token is configured', () => {
    expect(
      resolveVerificationChallenge(
        params({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }),
        ''
      )
    ).toBeNull()
  })
})
