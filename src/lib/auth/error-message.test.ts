import { describe, it, expect } from 'vitest'
import { authError, authErrorMessage } from './error-message'

describe('authErrorMessage', () => {
  it('never shows an empty object, the bug that prompted this', () => {
    // Observed live: with email delivery misconfigured, the reset page
    // rendered a bare "{}" where the explanation should have been.
    expect(authErrorMessage('{}')).not.toBe('{}')
    expect(authErrorMessage('{}')).toMatch(/went wrong/i)
    expect(authErrorMessage('{ }')).toMatch(/went wrong/i)
  })

  it('handles the other ways an empty failure arrives', () => {
    expect(authErrorMessage('')).toMatch(/went wrong/i)
    expect(authErrorMessage('   ')).toMatch(/went wrong/i)
    expect(authErrorMessage('[]')).toMatch(/went wrong/i)
    expect(authErrorMessage('null')).toMatch(/went wrong/i)
    expect(authErrorMessage(null)).toMatch(/went wrong/i)
    expect(authErrorMessage(undefined)).toMatch(/went wrong/i)
  })

  it('explains the failure a locked-out user is most likely to hit', () => {
    expect(authErrorMessage('Invalid login credentials')).toMatch(/don't match/i)
  })

  it('owns a mail failure rather than blaming the user', () => {
    // Suggesting they try another email would send someone chasing a
    // problem that is entirely ours.
    const shown = authErrorMessage('Error sending recovery email')
    expect(shown).toMatch(/on our side/i)
  })

  it('names the fix for a rate limit', () => {
    expect(authErrorMessage('over_email_send_rate_limit')).toMatch(/wait a minute/i)
    expect(authErrorMessage('Too many requests')).toMatch(/wait a minute/i)
  })

  it('keeps a short, already-readable provider message', () => {
    expect(authErrorMessage('Signups not allowed for this instance')).toBe(
      'Signups not allowed for this instance'
    )
  })

  it('replaces sprawling provider text rather than showing it', () => {
    // These carry ids, quotas and billing links — written for whoever holds
    // the API key, not for someone who forgot their password.
    const sprawling =
      'Rate limit reached for organization `org_abc123` on tokens per minute. Upgrade at https://example.com/billing'
    const shown = authErrorMessage(sprawling)
    expect(shown).not.toContain('org_abc123')
    expect(shown).not.toContain('http')
  })

  it('never returns an empty string, whatever it is given', () => {
    for (const input of ['{}', '', '...', 'null', '!!', undefined, null]) {
      expect(authErrorMessage(input).length).toBeGreaterThan(0)
    }
  })
})

describe('authError', () => {
  it('identifies a rate limit from the status when the body is empty', () => {
    // The case that made this intermittent failure unrecognisable: a 429
    // arriving with no body, so there is no message to match on at all.
    expect(authError({ status: 429 })).toMatch(/wait a minute/i)
    expect(authError({ status: 429, message: '' })).toMatch(/wait a minute/i)
  })

  it('still translates the message when there is one', () => {
    expect(authError({ message: 'Invalid login credentials' })).toMatch(/don't match/i)
  })

  it('handles a null error without throwing', () => {
    expect(authError(null)).toMatch(/went wrong/i)
  })
})

describe('authError falling back on status', () => {
  it('names a 500 as our fault, not the address', () => {
    // The real observed failure: GoTrue reports "Error sending recovery
    // email" under a `msg` field that supabase-js does not map onto
    // AuthError.message, so this arrives as a 500 with nothing to match on.
    // Matching text alone rendered it as "Something went wrong", sending the
    // user to re-check an email address that was never the problem.
    const shown = authError({ status: 500, message: '' })
    expect(shown).toMatch(/on our side/i)
    expect(shown).toMatch(/not with your address/i)
  })

  it('treats any 5xx the same way', () => {
    expect(authError({ status: 503 })).toMatch(/on our side/i)
  })

  it('still prefers a real message over the status', () => {
    expect(authError({ status: 500, message: 'Invalid login credentials' })).toMatch(/don't match/i)
  })

  it('points at the input for a 4xx rejection', () => {
    expect(authError({ status: 422 })).toMatch(/check the email address/i)
  })

  it('keeps the rate limit ahead of the generic 4xx branch', () => {
    expect(authError({ status: 429 })).toMatch(/wait a minute/i)
  })
})
