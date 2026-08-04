import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import SignOutButton from './sign-out-button'
import ReminderPoller from './reminder-poller'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <Link href="/" className="font-bold">
          🤖 Sofii
        </Link>
        <div className="flex items-center gap-4 text-sm text-neutral-400">
          <span>{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main>{children}</main>
      <ReminderPoller />
    </div>
  )
}
