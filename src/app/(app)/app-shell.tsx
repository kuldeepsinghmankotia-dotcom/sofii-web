'use client'

import { useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import Sidebar from './sidebar'
import CommandPalette from './command-palette'
import ReminderPoller from './reminder-poller'
import PushSubscribe from './push-subscribe'
import { Tooltip, TooltipProvider } from './tooltip'
import type { ConversationSummary } from '@/lib/db/conversations'

// Mirrors sidebar.tsx's SECONDARY_LINKS labels — shown next to the wordmark
// on mobile so navigating into one of these tool pages doesn't leave the
// header reading "SOFII" with no indication of where you actually are.
const SECTION_TITLES: Record<string, string> = {
  '/memories': 'Memories',
  '/reminders': 'Reminders',
  '/documents': 'Documents',
  '/calendar': 'Calendar'
}

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
  const pathname = usePathname()
  const sectionTitle = SECTION_TITLES[pathname]

  return (
    <TooltipProvider>
      {/* h-dvh (not 100vh/min-h-screen): on mobile, 100vh is measured against
      the largest possible viewport and stays fixed even when the browser's
      address bar is showing, leaving dead space or pushing content below
      the visible area. dvh tracks the real, current visible height. */}
      <div
        className="flex h-dvh overflow-hidden bg-[var(--bg)] text-[var(--text)]"
        style={{
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)'
        }}
      >
        <Sidebar
          initialConversations={initialConversations}
          userEmail={userEmail}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="glass flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 md:hidden">
            <Tooltip label="Open sidebar">
              <button
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
                className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]"
              >
                <Menu size={18} />
              </button>
            </Tooltip>
            <span className="flex items-baseline gap-1.5 truncate">
              <span className="font-display accent-text text-sm tracking-wide">SOFII</span>
              {sectionTitle && (
                <span className="truncate text-sm text-[var(--text-muted)]">· {sectionTitle}</span>
              )}
            </span>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
        <ReminderPoller />
        <PushSubscribe />
        <CommandPalette />
      </div>
    </TooltipProvider>
  )
}
