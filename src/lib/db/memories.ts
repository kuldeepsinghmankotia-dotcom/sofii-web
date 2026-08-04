import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

export interface Memory {
  id: string
  content: string
  created_at: string
  updated_at: string
  use_count: number
  last_used_at: string | null
}

const MEMORY_COLUMNS = 'id, content, created_at, updated_at, use_count, last_used_at'

export async function listMemories(supabase: Client): Promise<Memory[]> {
  const { data, error } = await supabase
    .from('memories')
    .select(MEMORY_COLUMNS)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data
}

export async function createMemory(
  supabase: Client,
  params: { userId: string; content: string }
): Promise<Memory> {
  const { data, error } = await supabase
    .from('memories')
    .insert({ user_id: params.userId, content: params.content })
    .select(MEMORY_COLUMNS)
    .single()

  if (error) throw error
  return data
}

export async function updateMemory(
  supabase: Client,
  id: string,
  content: string
): Promise<Memory> {
  const { data, error } = await supabase
    .from('memories')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(MEMORY_COLUMNS)
    .single()

  if (error) throw error
  return data
}

export async function deleteMemory(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from('memories').delete().eq('id', id)
  if (error) throw error
}

// Returns a promise rather than firing silently so the caller can decide how
// to handle failure — /api/chat fires it without awaiting (a usage-tracking
// side effect shouldn't add latency to the chat response) but still attaches
// a .catch() so errors land in logs instead of vanishing.
export async function recordMemoryUsage(supabase: Client, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.rpc('increment_memory_usage', { memory_ids: ids })
  if (error) throw error
}
