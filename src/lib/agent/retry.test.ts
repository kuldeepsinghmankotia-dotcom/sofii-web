import { describe, it, expect } from 'vitest'
import { isRateLimit, backoffDelayMs, RATE_LIMIT_BASE_DELAY_MS } from './retry'
import { explainFailure } from './executor'

describe('isRateLimit', () => {
  it('recognises a 429 status on the error object', () => {
    expect(isRateLimit(Object.assign(new Error('boom'), { status: 429 }))).toBe(true)
  })

  it('recognises the message Groq actually returns', () => {
    // The real observed failure: "429 Rate limit reached for model
    // `openai/gpt-oss-120b`". Matched by text because the SDK does not
    // always attach a status.
    expect(isRateLimit(new Error('429 Rate limit reached for model `openai/gpt-oss-120b`'))).toBe(true)
  })

  it('matches case-insensitively on the phrase', () => {
    expect(isRateLimit(new Error('Rate Limit exceeded'))).toBe(true)
  })

  it('does not treat other failures as rate limits', () => {
    // Retrying these spends the budget again to reach the same failure.
    expect(isRateLimit(new Error('Invalid API key'))).toBe(false)
    expect(isRateLimit(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false)
    expect(isRateLimit(new Error('network unreachable'))).toBe(false)
  })

  it('handles non-Error values without throwing', () => {
    expect(isRateLimit('rate limit')).toBe(true)
    expect(isRateLimit(null)).toBe(false)
    expect(isRateLimit(undefined)).toBe(false)
  })
})

describe('backoffDelayMs', () => {
  it('grows exponentially from the base', () => {
    expect(backoffDelayMs(0)).toBe(RATE_LIMIT_BASE_DELAY_MS)
    expect(backoffDelayMs(1)).toBe(RATE_LIMIT_BASE_DELAY_MS * 2)
    expect(backoffDelayMs(2)).toBe(RATE_LIMIT_BASE_DELAY_MS * 4)
  })

  it('waits long enough for a per-minute quota window to roll over', () => {
    // The point of the backoff: retrying a rate limit in milliseconds just
    // burns the next attempt against the same window.
    const total = backoffDelayMs(0) + backoffDelayMs(1) + backoffDelayMs(2)
    expect(total).toBeGreaterThanOrEqual(28_000)
  })
})

describe('explainFailure', () => {
  it('never leaks the provider error verbatim', () => {
    // The real observed message carried our organisation id, service tier,
    // exact token counts and a billing link. None of that belongs in front
    // of a user, and the org id should not leave the server at all.
    const raw =
      '429 Rate limit reached for model `openai/gpt-oss-120b` in organization ' +
      '`org_01kz1zbe0te4rt4t2tahhmywqa` service tier `on_demand` on tokens per minute ' +
      '(TPM): Limit 8000, Used 7312, Requested 4339. Upgrade at https://console.groq.com/settings/billing'
    const shown = explainFailure(raw)
    expect(shown).not.toContain('org_')
    expect(shown).not.toContain('console.groq.com')
    expect(shown).not.toContain('TPM')
    expect(shown).toMatch(/usage limit/i)
  })

  it('tells the user their completed steps survive, because they do', () => {
    expect(explainFailure('429 rate limit')).toMatch(/completed steps are kept/i)
  })

  it('distinguishes a timeout from a generic failure', () => {
    expect(explainFailure('The operation was aborted due to timeout')).toMatch(/too long/i)
  })

  it('falls back to something honest for anything unrecognised', () => {
    const shown = explainFailure('ECONNRESET while talking to internal-service-7')
    expect(shown).not.toContain('internal-service-7')
    expect(shown).toMatch(/went wrong/i)
  })
})
