import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

// Request-scoped: carries the calling user's session, so every query made
// through this client is subject to that user's Row Level Security policies
// (auth.uid() resolves correctly). Use in Server Components and Route
// Handlers — never share one instance across requests.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component during render, where cookies
            // can't be set — safe to ignore since middleware.ts refreshes
            // the session on every request anyway.
          }
        }
      }
    }
  )
}
