import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import { listConversations } from '@/lib/db/conversations'
import { getOwnRole } from '@/lib/db/profiles'
import AppShell from './app-shell'
import Onboarding from './onboarding'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    // Signed-out visitors get the marketing page rather than a bare
    // sign-in form. Previously every unauthenticated hit on "/" bounced
    // straight to /sign-in, which meant there was nothing to link to and
    // nothing explaining what Sofii is — the single biggest obstacle to
    // anyone actually signing up.
    redirect('/landing')
  }

  const [conversations, role, profile] = await Promise.all([
    listConversations(supabase),
    getOwnRole(supabase, user.id),
    supabase.from('profiles').select('onboarded_at').eq('id', user.id).maybeSingle()
  ])

  // Shown once per account. Rendered here rather than on the home page so
  // it appears no matter which route a new user lands on first (a shared
  // link, a bookmarked /documents, etc.).
  const needsOnboarding = !profile.data?.onboarded_at

  return (
    <AppShell
      initialConversations={conversations}
      userEmail={user.email ?? ''}
      isAdmin={role === 'admin'}
    >
      {needsOnboarding && <Onboarding />}
      {children}
    </AppShell>
  )
}
