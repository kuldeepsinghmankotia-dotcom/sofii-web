'use client'

import { useState, type ReactNode } from 'react'
import Sidebar from './sidebar'
import ReminderPoller from './reminder-poller'
import type { ConversationSummary } from '@/lib/db/conversations'

export default function AppShell({
  initialConversations,
  userEmail,
  children
}: {
  initialConversations: ConversationSummary[]
  userEmail: string
  children: ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    // h-dvh (not 100vh/min-h-screen): on mobile, 100vh is measured against
    // the largest possible viewport and stays fixed even when the browser's
    // address bar is showing, leaving dead space or pushing content below
    // the visible area. dvh tracks the real, current visible height.
    <div className="flex h-dvh overflow-hidden bg-black text-white">
      <Sidebar
        initialConversations={initialConversations}
        userEmail={userEmail}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-neutral-800 px-3 py-3 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
            className="rounded-lg p-1.5 text-neutral-300 hover:bg-neutral-900 hover:text-white"
          >
            ☰
          </button>
          <span className="font-bold">Sofii</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <ReminderPoller />
    </div>
  )
}
