import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/google/oauth'
import { upsertCalendarConnection } from '@/lib/db/calendar'

const STATE_COOKIE = 'google_oauth_state'

export async function GET(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const expectedState = request.cookies.get(STATE_COOKIE)?.value

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL('/calendar?error=invalid_state', request.url))
  }

  try {
    const redirectUri = new URL('/api/auth/google/callback', request.url).toString()
    const tokens = await exchangeCodeForTokens(code, redirectUri)

    if (!tokens.refresh_token) {
      // Shouldn't happen given prompt=consent, but without a refresh_token
      // this connection is useless past the first access_token's ~1hr life.
      return NextResponse.redirect(new URL('/calendar?error=no_refresh_token', request.url))
    }

    await upsertCalendarConnection(supabase, {
      userId: user.id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scope: tokens.scope
    })
  } catch (error) {
    console.error('Google OAuth callback error:', error)
    return NextResponse.redirect(new URL('/calendar?error=exchange_failed', request.url))
  }

  const response = NextResponse.redirect(new URL('/calendar?connected=1', request.url))
  response.cookies.delete(STATE_COOKIE)
  return response
}
