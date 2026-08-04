import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { buildGoogleAuthUrl } from '@/lib/google/oauth'

const STATE_COOKIE = 'google_oauth_state'

export async function GET(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  const state = randomUUID()
  const redirectUri = new URL('/api/auth/google/callback', request.url).toString()

  const response = NextResponse.redirect(buildGoogleAuthUrl(redirectUri, state))
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    // Secure cookies are dropped by the browser over plain http://, which
    // local dev uses — this would silently break the whole flow locally if
    // hardcoded to true.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/'
  })

  return response
}
