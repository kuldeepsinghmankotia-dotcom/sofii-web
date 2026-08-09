import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { backfillMessageEmbeddings } from '@/lib/db/message-embeddings'
import { getIngestRatelimit } from '@/lib/redis/ratelimit'

// Backfills embeddings for a user's pre-existing messages so
// cross-conversation recall works over their real history immediately,
// not just for conversations started after the feature shipped.
//
// Bounded per request and cursor-driven (the client loops, passing the
// returned cursor back) rather than embedding an entire history in one
// invocation, which would blow the function timeout on any substantial
// account. Shares the ingest rate limiter: this is the same class of
// heavy, quota-spending batch work.
const BATCH_SIZE = 50

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const rateLimit = await getIngestRatelimit().limit(user.id)
  if (!rateLimit.success) {
    return new Response('Rate limit exceeded — please try again later.', {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000))) }
    })
  }

  const body = (await request.json().catch(() => ({}))) as { cursor?: string }

  try {
    const result = await backfillMessageEmbeddings(supabase, {
      batchSize: BATCH_SIZE,
      before: body.cursor
    })
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Message embedding backfill error:', message)
    return new Response(message, { status: 500 })
  }
}
