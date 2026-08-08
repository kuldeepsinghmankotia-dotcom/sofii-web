import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { appendQueryExchange, getQueryHistory } from '@/lib/redis/query-history'

interface QueryRequestBody {
  query?: string
  documentIds?: string[]
  threadId?: string
}

// Authenticated proxy to the Python query-agent's /query endpoint — same
// shared-secret pattern as /api/ingest. document_ids ownership is enforced
// on the Python side (every document_chunks read there is filtered by
// both document_id AND user_id), so a stray ID from another user just
// yields "doesn't belong to you" rather than needing a second check here.
//
// threadId is client-generated and opaque to us — it only namespaces the
// Redis-backed short-term history (see lib/redis/query-history.ts) for this
// stateless workflow, the same "retain the last 5-10 exchanges" behavior
// the main chat now has, applied here since this agentic flow has no
// conversationId of its own to key off.
export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body = (await request.json()) as QueryRequestBody
  const query = body.query?.trim()

  if (!query) {
    return new Response('Missing query', { status: 400 })
  }

  const threadId = body.threadId ?? randomUUID()

  const serviceUrl = process.env.INGEST_SERVICE_URL
  const serviceSecret = process.env.INGEST_SERVICE_SECRET

  if (!serviceUrl || !serviceSecret) {
    return new Response('Query service is not configured', { status: 503 })
  }

  const history = await getQueryHistory(threadId)

  let upstream: Response
  try {
    upstream = await fetch(`${serviceUrl}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        user_id: user.id,
        document_ids: body.documentIds ?? [],
        history
      })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(`Query service unreachable: ${message}`, { status: 502 })
  }

  const responseBody = await upstream.text()

  let responseJson: { answer?: string } | null = null
  try {
    responseJson = JSON.parse(responseBody) as { answer?: string }
  } catch {
    // Non-JSON upstream body (e.g. a plain-text error) — pass through as-is.
  }

  if (upstream.ok && responseJson?.answer) {
    void appendQueryExchange(threadId, { query, answer: responseJson.answer })
  }

  const outBody =
    upstream.ok && responseJson ? JSON.stringify({ ...responseJson, threadId }) : responseBody

  return new Response(outBody, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' }
  })
}
