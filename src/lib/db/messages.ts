import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ContextSources } from './context-sources'

type Client = SupabaseClient<Database>

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  created_at: string
  image_url: string | null
  // Only ever set on assistant messages, and only when the reply actually
  // drew on something (see lib/db/context-sources.ts).
  context_sources?: ContextSources | null
}

const MESSAGE_COLUMNS = 'id, role, content, created_at, image_url, context_sources'

export async function listMessages(
  supabase: Client,
  conversationId: string
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data as ChatMessage[]
}

export async function insertMessage(
  supabase: Client,
  params: {
    conversationId: string
    userId: string
    role: MessageRole
    content: string
    imageUrl?: string
    contextSources?: ContextSources | null
  }
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: params.conversationId,
      user_id: params.userId,
      role: params.role,
      content: params.content,
      image_url: params.imageUrl ?? null,
      // Cast at this one serialization boundary: the generated Json type
      // requires an index signature that a precise interface can't have
      // without giving up its own field typing. ContextSources is plain
      // JSON-safe data (strings and arrays of strings), so this is sound.
      context_sources: (params.contextSources ?? null) as Database['public']['Tables']['messages']['Insert']['context_sources']
    })
    .select(MESSAGE_COLUMNS)
    .single()

  if (error) throw error
  return data as ChatMessage
}
