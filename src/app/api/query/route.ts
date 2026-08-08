import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface QueryRequestBody {
  query?: string
  documentIds?: string[]
}

// Authenticated proxy to the Python query-agent's /query endpoint — same
// shared-secret pattern as /api/ingest. document_ids ownership is enforced
// on the Python side (every document_chunks read there is filtered by
// both document_id AND user_id), so a stray ID from another user just
// yields "doesn't belong to you" rather than needing a second check here.
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

  const serviceUrl = process.env.INGEST_SERVICE_URL
  const serviceSecret = process.env.INGEST_SERVICE_SECRET

  if (!serviceUrl || !serviceSecret) {
    return new Response('Query service is not configured', { status: 503 })
  }

  let upstream: Response
  try {
    upstream = await fetch(`${serviceUrl}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        user_id: user.id,
        document_ids: body.documentIds ?? []
      })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(`Query service unreachable: ${message}`, { status: 502 })
  }

  const responseBody = await upstream.text()
  return new Response(responseBody, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' }
  })
}
