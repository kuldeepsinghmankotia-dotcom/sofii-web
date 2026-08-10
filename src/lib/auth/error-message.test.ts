import { describe, it, expect } from 'vitest'
import { authErrorMessage } from './error-message'

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
