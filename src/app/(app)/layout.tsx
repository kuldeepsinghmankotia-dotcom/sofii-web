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
        <div className="flex items-center gap-6">
          <Link href="/" className="font-bold">
            🤖 Sofii
          </Link>
          <nav className="flex items-center gap-4 text-sm text-neutral-300">
            <Link href="/" className="hover:text-white">
              Chat
            </Link>
            <Link href="/memories" className="hover:text-white">
              Memories
            </Link>
            <Link href="/reminders" className="hover:text-white">
              Reminders
            </Link>
            <Link href="/documents" className="hover:text-white">
              Documents
            </Link>
            <Link href="/calendar" className="hover:text-white">
              Calendar
            </Link>
          </nav>
        </div>
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
