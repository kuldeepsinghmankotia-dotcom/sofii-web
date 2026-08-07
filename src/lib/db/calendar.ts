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

// Explicit user_id-scoped variants for the digest cron
// (src/app/api/cron/digest/route.ts), which runs with the service-role
// admin client — no session, so RLS is bypassed entirely and the
// implicit-auth.uid() scoping the two functions above rely on doesn't
// apply. Without an explicit user_id filter here, updateCalendarAccessToken
// in particular would overwrite EVERY user's stored token in one call
// instead of just the one being refreshed.
export async function getCalendarConnectionForUser(
  supabase: Client,
  userId: string
): Promise<CalendarConnection | null> {
  const { data, error } = await supabase
    .from('calendar_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle()

  if (error) throw error
  return data
}

export async function updateCalendarAccessTokenForUser(
  supabase: Client,
  userId: string,
  params: { accessToken: string; expiresAt: string }
): Promise<void> {
  const { error } = await supabase
    .from('calendar_connections')
    .update({
      access_token: params.accessToken,
      expires_at: params.expiresAt,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .eq('provider', 'google')

  if (error) throw error
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
