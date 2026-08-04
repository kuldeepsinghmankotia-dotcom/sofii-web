import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

export interface ConversationSummary {
  id: string
  title: string
  updated_at: string
}

export async function listConversations(supabase: Client): Promise<ConversationSummary[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, updated_at')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getConversation(
  supabase: Client,
  conversationId: string
): Promise<{ id: string; title: string } | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, title')
    .eq('id', conversationId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function touchConversation(supabase: Client, conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) throw error
}

export const DEFAULT_CONVERSATION_TITLE = 'New conversation'

export async function renameConversation(
  supabase: Client,
  conversationId: string,
  title: string
): Promise<void> {
  const { error } = await supabase.from('conversations').update({ title }).eq('id', conversationId)

  if (error) throw error
}
