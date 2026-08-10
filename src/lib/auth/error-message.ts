/**
 * Turn a Supabase auth error into something a person can act on.
 *
 * Auth errors reach the screen more often than any other kind — they are the
 * first thing a new user meets, and they arrive at the exact moment someone
 * is already locked out and frustrated. Rendering the raw message is how a
 * password reset came to display a bare "{}": when email delivery was
 * misconfigured, the failure carried an empty body, and that empty object is
 * what the user saw where an explanation should have been.
 *
 * Anything unrecognised falls back to a plain sentence rather than whatever
 * the provider happened to say, since provider text is written for whoever
 * is holding the API key, not for the person who forgot their password.
 */

/** Provider messages mapped to something worth reading. */
const KNOWN: { match: RegExp; message: string }[] = [
  {
    match: /invalid login credentials/i,
    message: "That email and password don't match. Check both, or reset your password."
  },
  {
    match: /email not confirmed/i,
    message: 'Confirm your email first — check your inbox for the link we sent.'
  },
  {
    match: /user already registered|already been registered/i,
    message: 'There is already an account with that email. Try signing in instead.'
  },
  {
    match: /password should be at least/i,
    message: 'Pick a longer password — at least 6 characters.'
  },
  {
    match: /same.*password|should be different/i,
    message: 'That is already your password. Choose a different one.'
  },
  {
    match: /rate limit|too many requests|over_email_send_rate_limit/i,
    message: 'Too many attempts just now. Wait a minute and try again.'
  },
  {
    match: /error sending|smtp|mail/i,
    // The honest version: this is our problem, not something the user can
    // fix by trying a different email.
    message: "We couldn't send that email. This is on our side — please try again shortly."
  },
  {
    match: /token has expired|invalid.*token|expired/i,
    message: 'That link has expired. Request a new one.'
  },
  {
    match: /network|fetch failed|load failed/i,
    message: 'Could not reach the server. Check your connection and try again.'
  }
]

const FALLBACK = 'Something went wrong. Please try again.'

export function authErrorMessage(raw: string | null | undefined): string {
  if (!raw) return FALLBACK

  const trimmed = raw.trim()

  // The specific shape that started this: an empty or near-empty body
  // serialised into the message. Also covers "{}", "[]", "null", "undefined"
  // and bare punctuation, none of which mean anything to a reader.
  if (!trimmed || /^(\{\s*\}|\[\s*\]|null|undefined|\W{0,3})$/i.test(trimmed)) {
    return FALLBACK
  }

  for (const { match, message } of KNOWN) {
    if (match.test(trimmed)) return message
  }

  // Unrecognised but non-empty. Long provider strings tend to carry ids,
  // quotas and billing links, so anything sprawling is replaced rather than
  // shown.
  if (trimmed.length > 120 || trimmed.includes('http')) return FALLBACK

  return trimmed
}
