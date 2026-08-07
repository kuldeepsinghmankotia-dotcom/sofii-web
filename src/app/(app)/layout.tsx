import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import { listConversations } from '@/lib/db/conversations'
import { getOwnRole } from '@/lib/db/profiles'
import AppShell from './app-shell'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [conversations, role] = await Promise.all([
    listConversations(supabase),
    getOwnRole(supabase, user.id)
  ])

  return (
    <AppShell
      initialConversations={conversations}
      userEmail={user.email ?? ''}
      isAdmin={role === 'admin'}
    >
      {children}
    </AppShell>
  )
}
