import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  created_at: string
  image_url: string | null
}

const MESSAGE_COLUMNS = 'id, role, content, created_at, image_url'

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
  }
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: params.conversationId,
      user_id: params.userId,
      role: params.role,
      content: params.content,
      image_url: params.imageUrl ?? null
    })
    .select(MESSAGE_COLUMNS)
    .single()

  if (error) throw error
  return data as ChatMessage
}
