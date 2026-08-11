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

/**
 * Translate an auth error for display, and log the original.
 *
 * Sanitising the message cost something real: the first version of this
 * replaced a bare "{}" with a friendly sentence and, in doing so, threw away
 * the only evidence of what had actually failed — an intermittent fault
 * became undiagnosable for both the user and whoever was debugging it. The
 * original always goes to the console, where it costs the user nothing and
 * is there when someone needs it.
 *
 * Pass the whole error object where possible: a rate-limited response can
 * arrive with an empty body and therefore no message at all, and the status
 * is then the only thing that identifies it.
 */
export function authError(error: { message?: string; status?: number; name?: string } | null): string {
  if (error) {
    console.error('Auth error:', {
      name: error.name,
      status: error.status,
      message: error.message,
      // Explicit, because an empty message is exactly the case that is
      // impossible to recognise from the translated text alone.
      emptyMessage: !error.message?.trim()
    })
  }

  // Fall back on the status whenever there is no usable message.
  //
  // This is not a rare edge: GoTrue reports failures under a `msg` field,
  // which supabase-js does not map onto AuthError.message, so a real
  // "Error sending recovery email" reaches us as a 500 with an empty
  // message. Matching on text alone rendered that as a shrug — "Something
  // went wrong" — when the status already said plainly that it was a server
  // fault and not something the user could fix by retyping their address.
  // "Usable", not "present". The message that actually arrives here is the
  // string "{}" — non-empty, and completely meaningless. Treating presence
  // as usefulness is what let a 500 with a known cause fall through to a
  // shrug, and it is the same mistake in a new place: an empty body dressed
  // up as a value is still an empty body.
  const usable = isUsableMessage(error?.message)

  if (error?.status === 429) {
    return 'Too many attempts just now. Wait a minute and try again.'
  }

  if (!usable && error?.status) {
    // 5xx is ours. Saying so stops someone re-checking an email address
    // that was never the problem.
    if (error.status >= 500) {
      return "We couldn't send that email — this is a problem on our side, not with your address."
    }
    if (error.status === 422 || error.status === 400) {
      return 'That request was rejected. Check the email address and try again.'
    }
  }

  return authErrorMessage(error?.message)
}

/**
 * Whether a message says anything a reader could act on.
 *
 * The shape that started all of this is a message of literally "{}" — an
 * empty response body serialised into the message field. Also covers "[]",
 * "null", "undefined" and bare punctuation. All of them are present, and
 * none of them are information, which is exactly the distinction that
 * matters when deciding whether to fall back on the status code.
 */
export function isUsableMessage(raw: string | null | undefined): boolean {
  if (!raw) return false
  const trimmed = raw.trim()
  if (!trimmed) return false
  return !/^(\{\s*\}|\[\s*\]|null|undefined|\W{0,3})$/i.test(trimmed)
}

export function authErrorMessage(raw: string | null | undefined): string {
  if (!isUsableMessage(raw)) return FALLBACK

  const trimmed = (raw as string).trim()

  for (const { match, message } of KNOWN) {
    if (match.test(trimmed)) return message
  }

  // Unrecognised but non-empty. Long provider strings tend to carry ids,
  // quotas and billing links, so anything sprawling is replaced rather than
  // shown.
  if (trimmed.length > 120 || trimmed.includes('http')) return FALLBACK

  return trimmed
}
