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
): Promise<{ id: string; title: string; share_token: string | null } | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, share_token')
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

export async function deleteConversation(supabase: Client, conversationId: string): Promise<void> {
  const { error } = await supabase.from('conversations').delete().eq('id', conversationId)

  if (error) throw error
}

// Owner-only in practice: called with the RLS-scoped client, so this only
// ever affects a row the caller actually owns (conversations_update_own
// policy) — a non-owner's request matches zero rows rather than erroring,
// which is why the route calling this checks getConversation first.
export async function setConversationShareToken(
  supabase: Client,
  conversationId: string,
  token: string | null
): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ share_token: token })
    .eq('id', conversationId)

  if (error) throw error
}

// Called with the service-role admin client from the public share page
// (src/app/share/[token]/page.tsx) — deliberately not RLS-scoped, since an
// anonymous visitor has no session at all. Safe specifically because it
// filters by the exact, unguessable token rather than any user-scoped
// condition, so it can only ever return the one conversation matching that
// token.
export async function getConversationByShareToken(
  supabase: Client,
  token: string
): Promise<{ id: string; title: string } | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, title')
    .eq('share_token', token)
    .maybeSingle()

  if (error) throw error
  return data
}
