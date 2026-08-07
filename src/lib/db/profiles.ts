import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

export async function getOwnRole(supabase: Client, userId: string): Promise<'user' | 'admin'> {
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data.role as 'user' | 'admin'
}
