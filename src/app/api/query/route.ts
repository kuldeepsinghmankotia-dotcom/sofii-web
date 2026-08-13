import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { appendQueryExchange, getQueryHistory } from '@/lib/redis/query-history'
import { getQueryRatelimit } from '@/lib/redis/ratelimit'
import { answerFromDocuments } from '@/lib/documents/answer'

interface QueryRequestBody {
  query?: string
  documentIds?: string[]
  threadId?: string
}

// "Ask about your documents".
//
// Previously a proxy to the Python query agent on the developer's Mac, which
// meant this returned "Query service unreachable" whenever that machine was
// asleep — a visibly broken button rather than an absent feature. It now
// runs entirely in this app, using the same embeddings, the same hybrid
// search and the same model the chat route uses, so an answer here matches
// an answer there.
//
// threadId stays client-generated and opaque: it only namespaces the
// Redis-backed short-term history, since this flow has no conversationId of
// its own to key off.
export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const rateLimit = await getQueryRatelimit().limit(user.id)
  if (!rateLimit.success) {
    return new Response("You're sending questions too quickly — please slow down and try again shortly.", {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000))) }
    })
  }

  const body = (await request.json().catch(() => ({}))) as QueryRequestBody
  const query = body.query?.trim()

  if (!query) {
    return new Response('Missing query', { status: 400 })
  }

  const threadId = body.threadId ?? randomUUID()
  const history = await getQueryHistory(threadId).catch(() => [])

  // Document ownership is enforced by RLS on the chunk search itself: the
  // caller's session client can only ever match their own chunks, so a
  // stray id from someone else's document simply matches nothing.
  const { answer, sources } = await answerFromDocuments({
    supabase,
    query,
    documentIds: body.documentIds ?? [],
    history
  })

  // Awaited, not fire-and-forget: this is a plain JSON response with no
  // stream keeping the function alive, so an un-awaited write can be killed
  // the moment the response returns.
  await appendQueryExchange(threadId, { query, answer }).catch((error) => {
    // History is a convenience for follow-up questions; losing it must not
    // cost the user the answer they already have.
    console.error('Could not record query history:', error)
  })

  return Response.json({ answer, sources, threadId })
}
