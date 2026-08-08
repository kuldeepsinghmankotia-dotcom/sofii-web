// Short-timeout reachability check for the Python ingestion/query service,
// which runs on the user's own Mac behind a Cloudflare Tunnel — the single
// biggest availability risk in this app (see agentic-ingestion-plan.md).
// Used to show an honest "offline" banner on page load instead of letting
// a user discover it only after an upload or query fails.
const HEALTH_CHECK_TIMEOUT_MS = 4000

export async function isIngestServiceOnline(): Promise<boolean> {
  const serviceUrl = process.env.INGEST_SERVICE_URL
  const serviceSecret = process.env.INGEST_SERVICE_SECRET
  if (!serviceUrl || !serviceSecret) return false

  try {
    const response = await fetch(`${serviceUrl}/health`, {
      headers: { Authorization: `Bearer ${serviceSecret}` },
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
    })
    return response.ok
  } catch {
    return false
  }
}
