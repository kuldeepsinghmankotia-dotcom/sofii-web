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
    // h-dvh (dynamic viewport height, not 100vh/min-h-screen): on mobile,
    // 100vh is measured against the *largest* possible viewport and stays
    // fixed even when the browser's address bar is showing, which either
    // leaves dead space or pushes the composer below the visible area.
    // dvh tracks the real, current visible height as browser chrome
    // shows/hides. flex-col + the header/main split below is what actually
    // makes only the message list scroll instead of the whole page.
    <div className="flex h-dvh flex-col overflow-hidden bg-black text-white">
      <header className="flex shrink-0 items-center justify-between gap-2 overflow-x-auto border-b border-neutral-800 px-3 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-3 sm:gap-6">
          <Link href="/" className="shrink-0 font-bold">
            🤖 Sofii
          </Link>
          <nav className="flex shrink-0 items-center gap-3 text-sm text-neutral-300 sm:gap-4">
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
        <div className="flex shrink-0 items-center gap-2 text-sm text-neutral-400 sm:gap-4">
          <span className="hidden sm:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      <ReminderPoller />
    </div>
  )
}
