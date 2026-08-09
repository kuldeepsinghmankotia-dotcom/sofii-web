import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { embedText, embedTexts } from '@/lib/gemini/embeddings'

type Client = SupabaseClient<Database>

export interface RecalledMessage {
  id: string
  conversation_id: string
  conversation_title: string
  role: string
  content: string
  created_at: string
  similarity: number
}

// Short turns ("ok", "thanks", "yes please") carry no recallable meaning,
// and embedding them would spend real API quota to fill the index with
// noise that then competes with substantive matches. The migration's
// index is partial (embedding is not null) specifically so these rows
// cost nothing.
const MIN_EMBEDDABLE_CHARS = 40

// gemini-embedding-001 has a real input-token ceiling; a very long
// assistant reply is truncated rather than failing the whole embed. The
// opening of a message carries the topic, which is what recall keys off.
const MAX_EMBEDDABLE_CHARS = 8000

export function isWorthEmbedding(content: string): boolean {
  return content.trim().length >= MIN_EMBEDDABLE_CHARS
}

/**
 * Embeds and stores vectors for the given messages. Best-effort by
 * design: called from an after() hook once a reply has already been sent
 * (see api/chat/route.ts), so a failure here must never surface to the
 * user — worst case a turn isn't recallable later, which is strictly
 * better than breaking the chat that already succeeded.
 */
export async function embedMessages(
  supabase: Client,
  messages: { id: string; content: string }[]
): Promise<void> {
  const embeddable = messages.filter((m) => isWorthEmbedding(m.content))
  if (embeddable.length === 0) return

  try {
    const vectors = await embedTexts(
      embeddable.map((m) => m.content.slice(0, MAX_EMBEDDABLE_CHARS))
    )

    await Promise.all(
      embeddable.map((message, index) =>
        supabase
          .from('messages')
          .update({ embedding: JSON.stringify(vectors[index]) })
          .eq('id', message.id)
      )
    )
  } catch (error) {
    console.error('Message embedding error:', error)
  }
}

/**
 * Finds semantically related messages from the user's OTHER
 * conversations — the current one's history is already in context in
 * full, so re-injecting it would waste the budget (see the migration's
 * own comment on exclude_conversation_id).
 *
 * Takes an already-computed embedding rather than raw text: the chat
 * route embeds the user's message once for document recall and reuses
 * that same vector here, instead of paying a second embedding call and
 * round-trip per turn for identical input.
 *
 * Returns [] rather than throwing on failure: cross-conversation recall
 * is a bonus on top of a reply that works fine without it, exactly like
 * the existing document-recall path.
 */
export async function recallRelatedMessages(
  supabase: Client,
  queryEmbedding: number[],
  excludeConversationId: string,
  matchCount = 4
): Promise<RecalledMessage[]> {
  try {
    const { data, error } = await supabase.rpc('match_messages', {
      query_embedding: JSON.stringify(queryEmbedding),
      exclude_conversation_id: excludeConversationId,
      match_count: matchCount
    })

    if (error) throw error
    return (data ?? []) as RecalledMessage[]
  } catch (error) {
    console.error('Cross-conversation recall error:', error)
    return []
  }
}

// Text-taking variant for callers that don't already have an embedding on
// hand (the recall_past_conversations tool, which searches on a query the
// model composes itself rather than on the user's raw message).
export async function recallRelatedMessagesByText(
  supabase: Client,
  query: string,
  excludeConversationId: string,
  matchCount = 4
): Promise<RecalledMessage[]> {
  try {
    const queryEmbedding = await embedText(query)
    return await recallRelatedMessages(supabase, queryEmbedding, excludeConversationId, matchCount)
  } catch (error) {
    console.error('Cross-conversation recall error:', error)
    return []
  }
}

/**
 * Embeds messages that predate this feature (or that failed to embed at
 * the time), so recall works over a user's existing history immediately
 * rather than only for conversations started from now on.
 *
 * Cursor-paginated on created_at rather than repeatedly re-querying "the
 * first N rows with a null embedding". That naive version deadlocks:
 * messages below MIN_EMBEDDABLE_CHARS are deliberately never given an
 * embedding, so they stay null forever, permanently occupy the first N
 * slots, and the scan never reaches older embeddable rows behind them.
 * The cursor always moves past everything already examined, embeddable or
 * not, so progress is guaranteed.
 *
 * Bounded per call, with the next cursor returned, so the caller controls
 * total cost instead of this embedding a huge backlog in one request.
 */
export async function backfillMessageEmbeddings(
  supabase: Client,
  options: { batchSize?: number; before?: string } = {}
): Promise<{ embedded: number; scanned: number; nextCursor: string | null }> {
  const batchSize = options.batchSize ?? 50

  let query = supabase
    .from('messages')
    .select('id, content, created_at')
    .is('embedding', null)
    .order('created_at', { ascending: false })
    .limit(batchSize)

  if (options.before) query = query.lt('created_at', options.before)

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as { id: string; content: string; created_at: string }[]
  if (rows.length === 0) return { embedded: 0, scanned: 0, nextCursor: null }

  const embeddable = rows.filter((m) => isWorthEmbedding(m.content))
  await embedMessages(supabase, embeddable)

  // Only advance the cursor when the batch was full; a short batch means
  // the end of the table was reached, so there is nothing left to page to.
  const nextCursor = rows.length === batchSize ? rows[rows.length - 1].created_at : null

  return { embedded: embeddable.length, scanned: rows.length, nextCursor }
}
