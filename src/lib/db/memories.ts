import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

export interface Memory {
  id: string
  content: string
  created_at: string
  updated_at: string
}

export async function listMemories(supabase: Client): Promise<Memory[]> {
  const { data, error } = await supabase
    .from('memories')
    .select('id, content, created_at, updated_at')
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
    .select('id, content, created_at, updated_at')
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
    .select('id, content, created_at, updated_at')
    .single()

  if (error) throw error
  return data
}

export async function deleteMemory(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from('memories').delete().eq('id', id)
  if (error) throw error
}
