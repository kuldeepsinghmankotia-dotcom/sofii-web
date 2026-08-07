import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Cron/admin only — bypasses Row Level Security entirely via the
// service-role key. Unlike src/lib/supabase/server.ts, this carries no
// user session (a scheduled cron invocation has none) and can read/write
// any user's rows, which is exactly what the digest cron needs to act
// across every subscribed user in one run. Never import this from a
// Server Component, a route handler that serves a logged-in user's own
// request, or anywhere reachable from client code — those should keep
// using the RLS-scoped createClient() so a bug can't leak one user's data
// to another.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
