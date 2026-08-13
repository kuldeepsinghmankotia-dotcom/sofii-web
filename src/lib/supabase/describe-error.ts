/**
 * Make a Supabase error readable in a log.
 *
 * PostgrestError is a plain object whose fields are not enumerable the way
 * console expects, so it serialises to `{}`. A log full of `⨯ {}` is worse
 * than no log: it proves something is failing and tells you nothing about
 * what — 307 of them accumulated in this project's dev log before anyone
 * noticed the reminder poller had been failing every 30 seconds.
 *
 * This is the same trap that made a password reset show a bare "{}" to the
 * user (see lib/auth/error-message.ts). Same cause, different surface.
 */
export function describeSupabaseError(error: unknown): string {
  if (!error) return 'unknown error'

  if (typeof error === 'string') return error

  if (error instanceof Error && error.message) {
    return error.message
  }

  const e = error as { code?: string; message?: string; details?: string; hint?: string }
  const parts = [
    e.code ? `code=${e.code}` : null,
    e.message ? `message=${e.message}` : null,
    e.details ? `details=${e.details}` : null,
    e.hint ? `hint=${e.hint}` : null
  ].filter(Boolean)

  if (parts.length > 0) return parts.join(' ')

  // Last resort: force the object through JSON so at least *something*
  // identifiable reaches the log, rather than the empty braces console gives.
  try {
    const json = JSON.stringify(error)
    return json && json !== '{}' ? json : `unserialisable error (${typeof error})`
  } catch {
    return `unserialisable error (${typeof error})`
  }
}
