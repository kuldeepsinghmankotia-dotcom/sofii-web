import { createAdminClient } from '@/lib/supabase/admin'

export const INGESTION_ENDPOINT_KEY = 'ingestion'

/**
 * Hostnames the ingestion service is allowed to live on.
 *
 * This matters more than it looks: the resolved URL is where the server
 * sends INGEST_SERVICE_SECRET as a bearer token. Anything that can put a
 * value in service_endpoints could otherwise redirect that secret to a host
 * it controls, so the stored value is treated as untrusted input and checked
 * against a fixed shape rather than used as-is.
 *
 * The env var's own host is always allowed, so pointing the service at a
 * named tunnel or a custom domain later needs no change here.
 */
function isAllowedHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true
  if (hostname.endsWith('.trycloudflare.com')) return true

  const configured = process.env.INGEST_SERVICE_URL
  if (configured) {
    try {
      if (new URL(configured).hostname === hostname) return true
    } catch {
      // A malformed env var shouldn't widen the allowlist.
    }
  }

  return false
}

/**
 * Whether a stored endpoint is safe to send the shared secret to.
 * Exported so the allowlist can be tested directly — it is the boundary
 * that keeps a database value from redirecting a bearer token.
 */
export function isUsableIngestUrl(candidate: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return false
  }

  // http is permitted only for loopback (local development); anything
  // reachable over the network must be https, since the shared secret
  // travels in the header.
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(isLoopback && parsed.protocol === 'http:')) return false

  return isAllowedHost(parsed.hostname)
}

/**
 * The ingestion service's current base URL.
 *
 * Prefers the database, because a quick tunnel's hostname changes on every
 * cloudflared restart and the database can be updated without a redeploy —
 * the env var is the fallback for a fresh environment where nothing has
 * registered yet.
 *
 * Never cached: a stale value here means every upload fails, and this runs
 * once per upload (not per page render), so re-reading is cheap relative to
 * being wrong.
 */
export async function resolveIngestServiceUrl(): Promise<string | null> {
  const fallback = process.env.INGEST_SERVICE_URL ?? null

  // Uses the admin client because this table is intentionally invisible to
  // every non-service_role role — see the migration's comment.
  let stored: string | null = null
  try {
    const { data, error } = await createAdminClient()
      .from('service_endpoints')
      .select('url')
      .eq('key', INGESTION_ENDPOINT_KEY)
      .maybeSingle()

    if (error) throw error
    stored = data?.url ?? null
  } catch (error) {
    // A registry lookup failure must not take ingestion down while the env
    // var still holds a working URL.
    console.error('Could not read ingestion service endpoint, falling back to env:', error)
    return fallback
  }

  if (!stored) return fallback

  if (!isUsableIngestUrl(stored)) {
    console.error('Registered ingestion endpoint rejected by allowlist, falling back to env:', stored)
    return fallback
  }

  // Trailing slashes would produce "…//ingest" once a path is appended.
  return stored.replace(/\/+$/, '')
}
