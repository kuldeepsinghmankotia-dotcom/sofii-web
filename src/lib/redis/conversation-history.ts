import { getRedis } from './client'
import type { ChatMessage, MessageRole } from '@/lib/db/messages'

// Short-term cache-aside layer in front of Supabase for chat history reads.
// Supabase remains the durable source of truth (every write still goes
// there first, now reliably — see the persist-failure fix in
// api/chat/route.ts); this only exists to skip a Postgres round-trip on
// the common case of continuing an already-active conversation, and to
// keep responding "in line" even if a read happens to race a slow/failed
// Supabase read. Every operation here is best-effort: a Redis failure
// falls back to (or just re-uses) the Supabase path rather than ever
// failing the chat response.
const MAX_CACHED_MESSAGES = 20 // ~10 user/assistant exchanges
const TTL_SECONDS = 60 * 60

interface CachedMessage {
  role: MessageRole
  content: string
  image_url: string | null
}

function historyKey(conversationId: string): string {
  return `chat:history:${conversationId}`
}

export async function getCachedHistory(conversationId: string): Promise<ChatMessage[] | null> {
  try {
    const redis = getRedis()
    const cached = await redis.get<CachedMessage[]>(historyKey(conversationId))
    if (!cached) return null

    return cached.map((m) => ({
      id: '',
      role: m.role,
      content: m.content,
      created_at: '',
      image_url: m.image_url
    }))
  } catch (error) {
    console.error('Redis history read error:', error)
    return null
  }
}

export async function setCachedHistory(conversationId: string, messages: ChatMessage[]): Promise<void> {
  try {
    const redis = getRedis()
    const trimmed: CachedMessage[] = messages.slice(-MAX_CACHED_MESSAGES).map((m) => ({
      role: m.role,
      content: m.content,
      image_url: m.image_url
    }))
    await redis.set(historyKey(conversationId), trimmed, { ex: TTL_SECONDS })
  } catch (error) {
    console.error('Redis history write error:', error)
  }
}

export async function appendCachedMessages(
  conversationId: string,
  newMessages: CachedMessage[]
): Promise<void> {
  try {
    const redis = getRedis()
    const existing = (await redis.get<CachedMessage[]>(historyKey(conversationId))) ?? []
    const updated = [...existing, ...newMessages].slice(-MAX_CACHED_MESSAGES)
    await redis.set(historyKey(conversationId), updated, { ex: TTL_SECONDS })
  } catch (error) {
    console.error('Redis history append error:', error)
  }
}

export async function invalidateCachedHistory(conversationId: string): Promise<void> {
  try {
    const redis = getRedis()
    await redis.del(historyKey(conversationId))
  } catch (error) {
    console.error('Redis history invalidate error:', error)
  }
}
