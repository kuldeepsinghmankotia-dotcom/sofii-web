import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
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

/**
 * The signed-in user, fetched at most once per request.
 *
 * getUser() is not a local token decode — it is a network call to Supabase
 * Auth to validate the JWT, and every caller pays for it. A single
 * authenticated page render was making three of them: one in middleware, one
 * in the layout, and one in the page, all sequential, all asking the same
 * question. From India that is roughly a second of latency before anything
 * renders, which is precisely the "slow to log in" complaint.
 *
 * React's cache() dedupes within a single request, so the layout and the
 * page now share one call. Middleware runs in a separate invocation and
 * cannot share it, but its call is doing real work — refreshing the session
 * cookie — rather than merely re-asking.
 *
 * Safe to call anywhere on the server: it returns the same object every time
 * within one request, and is never shared across requests.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  return user
})
