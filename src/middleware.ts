import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Refreshes the Supabase session cookie on every request. Auth *gating*
// (redirecting signed-out users) happens in app/(app)/layout.tsx, not here.
export async function middleware(request: NextRequest) {
  const { supabaseResponse } = await updateSession(request)
  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']
}
