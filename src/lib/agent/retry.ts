/**
 * Waiting out model rate limits.
 *
 * A 429 is the most likely way agent work fails: planning and each step make
 * their own model calls, several per step once tools are involved, and on a
 * free tier that ceiling arrives quickly. Measured for real — two concurrent
 * tasks put one straight into `429 Rate limit reached` at its first step.
 *
 * Failing outright for a limit that clears in seconds is a bad trade. The
 * user is not watching a background task, so a short wait costs them
 * nothing, while a failure costs every step already completed.
 */

export const RATE_LIMIT_RETRIES = 3

/**
 * Exponential from 4s (4s, 8s, 16s).
 *
 * Sized for a per-minute quota window to actually roll over, unlike the
 * sub-second retries that suit a transient network blip — retrying a rate
 * limit too quickly just consumes the next attempt against the same window.
 */
export const RATE_LIMIT_BASE_DELAY_MS = 4000

export function isRateLimit(error: unknown): boolean {
  const status = (error as { status?: number })?.status
  if (status === 429) return true
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('429') || message.toLowerCase().includes('rate limit')
}

export function backoffDelayMs(attempt: number, base = RATE_LIMIT_BASE_DELAY_MS): number {
  return base * 2 ** attempt
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run a model call, retrying only when rate limited.
 *
 * Anything else is a real error; retrying it spends the budget again to
 * arrive at the same failure.
 */
export async function withRateLimitRetry<T>(call: () => Promise<T>): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    try {
      return await call()
    } catch (error) {
      lastError = error
      if (!isRateLimit(error) || attempt === RATE_LIMIT_RETRIES) throw error

      const delay = backoffDelayMs(attempt)
      console.warn(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1})`)
      await sleep(delay)
    }
  }

  throw lastError
}
