import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

export interface CalendarConnection {
  access_token: string
  refresh_token: string
  expires_at: string
}

export async function getCalendarConnection(supabase: Client): Promise<CalendarConnection | null> {
  const { data, error } = await supabase
    .from('calendar_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('provider', 'google')
    .maybeSingle()

  if (error) throw error
  return data
}

export async function upsertCalendarConnection(
  supabase: Client,
  params: {
    userId: string
    accessToken: string
    refreshToken: string
    expiresAt: string
    scope: string
  }
): Promise<void> {
  const { error } = await supabase.from('calendar_connections').upsert(
    {
      user_id: params.userId,
      provider: 'google',
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
      expires_at: params.expiresAt,
      scope: params.scope,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,provider' }
  )

  if (error) throw error
}

export async function updateCalendarAccessToken(
  supabase: Client,
  params: { accessToken: string; expiresAt: string }
): Promise<void> {
  const { error } = await supabase
    .from('calendar_connections')
    .update({
      access_token: params.accessToken,
      expires_at: params.expiresAt,
      updated_at: new Date().toISOString()
    })
    .eq('provider', 'google')

  if (error) throw error
}

export async function deleteCalendarConnection(supabase: Client): Promise<void> {
  const { error } = await supabase.from('calendar_connections').delete().eq('provider', 'google')
  if (error) throw error
}
