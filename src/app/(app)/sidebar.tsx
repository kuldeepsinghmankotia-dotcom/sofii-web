'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useAnimation, useReducedMotion, type PanInfo } from 'framer-motion'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Bell,
  Calendar,
  FileText,
  Inbox,
  ListChecks,
  MoreHorizontal,
  Pencil,
  MessageCircle,
  MessageSquarePlus,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { ConversationSummary } from '@/lib/db/conversations'
import { useSwipeAction } from '@/lib/gestures/swipe-action'
import SignOutButton from './sign-out-button'
import ThemeToggle from './theme-toggle'
import { Tooltip } from './tooltip'
import { MOBILE_QUERY, useIsMobile } from './use-is-mobile'
import { openFeedback } from './feedback-widget'

// w-72 in Tailwind's default scale.
const SIDEBAR_WIDTH_PX = 288
// Below this leftward drag distance (or above this leftward velocity), a
// release snaps back open instead of closing — distinguishes an intentional
// dismiss swipe from an incidental drag/scroll touch.
const CLOSE_DRAG_THRESHOLD_PX = 80
const CLOSE_VELOCITY_THRESHOLD = 500

// Any mutation anywhere in the app (new chat, rename, delete, or the
// server-side auto-title after a conversation's first exchange) dispatches
// this so the sidebar — a sibling component with no direct prop path to
// those call sites — knows to refetch. Simpler and more robust than a
// Supabase Realtime subscription for a single-tab, single-user app like
// this one.
const CONVERSATIONS_CHANGED_EVENT = 'sofii:conversations-changed'

export function notifyConversationsChanged(): void {
  window.dispatchEvent(new Event(CONVERSATIONS_CHANGED_EVENT))
}

const SECONDARY_LINKS = [
  { href: '/memories', label: 'Memories', icon: Sparkles },
  { href: '/reminders', label: 'Reminders', icon: Bell },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle }
]

const ADMIN_LINKS = [
  { href: '/admin/system-prompt', label: 'System Prompt', icon: ShieldCheck },
  { href: '/admin/feedback', label: 'Feedback inbox', icon: Inbox }
]

type Group = { label: string; items: ConversationSummary[] }

/**
 * One conversation in the list.
 *
 * Split out of the map purely so it can hold a hook: swipe state is
 * per-row, and hooks cannot be called inside a loop callback.
 *
 * The swipe is an addition, not a replacement — the "..." menu still holds
 * Rename and Delete, and remains the only route available with a keyboard,
 * a mouse, or a screen reader. Swiping only ever *opens the existing
 * confirmation dialog*: a gesture this easy to perform by accident while
 * scrolling must not be able to destroy a conversation on its own.
 */
function ConversationRow({
  conversation,
  isActive,
  onNavigate,
  onRequestDelete,
  children
}: {
  conversation: ConversationSummary
  isActive: boolean
  onNavigate: () => void
  onRequestDelete: () => void
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const { offset, armed, handlers } = useSwipeAction({ onTrigger: onRequestDelete })

  return (
    // The wrapper stays put and hosts the revealed action; only the inner
    // surface travels, so the affordance appears from underneath rather
    // than sliding in alongside.
    <div className="relative overflow-hidden rounded-lg">
      {offset < 0 && (
        <div
          aria-hidden="true"
          className={`absolute inset-y-0 right-0 flex items-center justify-center rounded-r-lg pr-3 pl-4 transition-colors ${
            armed ? 'bg-[var(--danger)] text-white' : 'bg-red-500/15 text-[var(--danger)]'
          }`}
        >
          <Trash2 size={16} />
        </div>
      )}

      <div
        {...handlers}
        // Transform is driven directly rather than through framer-motion's
        // `animate`, which was measured setting `transform: none` on this
        // element even while offset was clearly negative — the row simply
        // never moved. Direct style is also the better fit for a drag: it
        // tracks the finger exactly, with none of the lag a spring
        // introduces between the touch and the row.
        style={{
          transform: `translateX(${offset}px)`,
          // Only the snap back is animated. While a finger is down the row
          // must follow it 1:1, so any transition there would feel like the
          // row is lagging behind the touch.
          transition: offset === 0 && !reducedMotion ? 'transform 180ms ease-out' : 'none'
        }}
        className={`group relative flex touch-pan-y items-center gap-1 rounded-lg py-1.5 pr-1 pl-3 text-sm ${
          isActive
            ? 'bg-[var(--surface-active)]'
            : // Opaque only while the row is actually travelling, so it hides
              // the delete affordance underneath. At rest it must stay
              // transparent: the sidebar is a translucent `glass` panel, and
              // a solid fill here reads as a filled box against it.
              offset < 0
              ? 'bg-[var(--bg-elevated)]'
              : 'hover:bg-[var(--surface-hover)]'
        }`}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full"
            style={{ background: 'var(--accent-gradient)' }}
          />
        )}
        <Link
          href={`/c/${conversation.id}`}
          // A swipe ends with a pointerup over the link, which the browser
          // then turns into a click. Without this, swiping to delete also
          // navigates to the conversation being deleted.
          onClick={(event) => {
            if (offset !== 0) {
              event.preventDefault()
              return
            }
            onNavigate()
          }}
          className={`min-w-0 flex-1 truncate ${isActive ? 'text-[var(--text)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text)]'}`}
        >
          {conversation.title}
        </Link>
        {children}
      </div>
    </div>
  )
}

function groupByRecency(items: ConversationSummary[]): Group[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfWeek.getDate() - 7)

  const buckets: Group[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] }
  ]

  for (const item of items) {
    const updatedAt = new Date(item.updated_at)
    if (updatedAt >= startOfToday) buckets[0].items.push(item)
    else if (updatedAt >= startOfYesterday) buckets[1].items.push(item)
    else if (updatedAt >= startOfWeek) buckets[2].items.push(item)
    else buckets[3].items.push(item)
  }

  return buckets.filter((bucket) => bucket.items.length > 0)
}

export default function Sidebar({
  initialConversations,
  userEmail,
  isAdmin,
  open,
  onClose
}: {
  initialConversations: ConversationSummary[]
  userEmail: string
  isAdmin: boolean
  open: boolean
  onClose: () => void
}) {
  const [conversations, setConversations] = useState(initialConversations)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const router = useRouter()
  const pathname = usePathname()
  const activeId = pathname.match(/^\/c\/([^/]+)/)?.[1]
  const isMobile = useIsMobile()
  const dragControls = useAnimation()
  const hasSetInitialPositionRef = useRef(false)

  // Keeps the panel's actual transform in sync with the open/closed prop
  // and the mobile/desktop breakpoint — the single source of truth for
  // where the drag gesture below should leave it once released.
  //
  // Reads the viewport directly here via matchMedia rather than trusting
  // the isMobile hook value: that hook intentionally starts false and only
  // resolves the real value a tick later (via queueMicrotask, to stay
  // hydration-safe for the `drag` prop below) — using it here too would
  // race this effect against that correction, and depending on exact
  // timing could animate a visible slide-shut on every mobile page load
  // instead of mounting already-closed. Reading matchMedia fresh means the
  // very first .set() is always correct immediately, regardless of that
  // timing. The isMobile *hook* value is still a dependency so this reruns
  // (harmlessly — same real position, .start() to itself is a no-op) once
  // it resolves, keeping things in sync if the two ever diverge.
  useEffect(() => {
    const reallyMobile = window.matchMedia(MOBILE_QUERY).matches
    const x = reallyMobile ? (open ? 0 : -SIDEBAR_WIDTH_PX) : 0
    if (!hasSetInitialPositionRef.current) {
      dragControls.set({ x })
      hasSetInitialPositionRef.current = true
    } else {
      dragControls.start({ x })
    }
  }, [open, isMobile, dragControls])

  const handleDragEnd = (_e: unknown, info: PanInfo): void => {
    const shouldClose =
      info.offset.x < -CLOSE_DRAG_THRESHOLD_PX || info.velocity.x < -CLOSE_VELOCITY_THRESHOLD
    if (shouldClose) {
      onClose()
    } else {
      dragControls.start({ x: 0 })
    }
  }

  const refresh = async (): Promise<void> => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, updated_at')
      .order('updated_at', { ascending: false })
    if (!error && data) setConversations(data)
  }

  useEffect(() => {
    window.addEventListener(CONVERSATIONS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(CONVERSATIONS_CHANGED_EVENT, refresh)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, query])

  const groups = useMemo(() => groupByRecency(filtered), [filtered])

  const handleNewChat = async (): Promise<void> => {
    setCreating(true)
    const supabase = createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      setCreating(false)
      return
    }

    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: user.id })
      .select('id')
      .single()

    setCreating(false)
    if (error || !data) return

    onClose()
    router.push(`/c/${data.id}`)
    notifyConversationsChanged()
  }

  const startRename = (conversation: ConversationSummary): void => {
    setRenamingId(conversation.id)
    setRenameValue(conversation.title)
  }

  const commitRename = async (id: string): Promise<void> => {
    const title = renameValue.trim()
    setRenamingId(null)
    if (!title) return

    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
    const supabase = createClient()
    await supabase.from('conversations').update({ title }).eq('id', id)
    notifyConversationsChanged()
  }

  const handleRenameKeyDown =
    (id: string) =>
    (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter') void commitRename(id)
      else if (e.key === 'Escape') setRenamingId(null)
    }

  const handleDelete = async (id: string): Promise<void> => {
    setConfirmDeleteId(null)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    const supabase = createClient()
    await supabase.from('conversations').delete().eq('id', id)
    notifyConversationsChanged()
    if (activeId === id) router.push('/')
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={onClose}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      <motion.aside
        drag={isMobile ? 'x' : false}
        dragConstraints={{ left: -SIDEBAR_WIDTH_PX, right: 0 }}
        dragElastic={0.05}
        animate={dragControls}
        onDragEnd={handleDragEnd}
        transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
        className="glass fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col border-r border-[var(--border)] md:static md:z-auto"
      >
        <div className="flex shrink-0 items-center justify-between px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-3">
          <Link
            href="/"
            onClick={onClose}
            className="font-display accent-text text-lg tracking-wide"
          >
            SOFII
          </Link>
          <Tooltip label="Close sidebar">
            <button
              onClick={onClose}
              aria-label="Close sidebar"
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover-strong)] hover:text-[var(--text)] md:hidden"
            >
              <X size={16} />
            </button>
          </Tooltip>
        </div>

        <div className="shrink-0 px-3 pb-3">
          <button
            onClick={handleNewChat}
            disabled={creating}
            className="relative flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-strong)] px-3 py-2.5 text-sm font-medium text-[var(--text)] transition hover:border-[var(--accent-a)] hover:shadow-[var(--shadow-glow-a)] disabled:opacity-60"
          >
            <Plus size={16} className="accent-icon" aria-hidden="true" />
            {creating ? 'Creating…' : 'New chat'}
          </button>
        </div>

        <div className="accent-ring shrink-0 px-3 pb-3">
          <div className="relative rounded-xl">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-input)] py-1.5 pr-12 pl-8 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              ⌘K
            </kbd>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {groups.length === 0 && (
            <p className="px-2 py-4 text-sm text-[var(--text-muted)]">
              {query ? 'No matching chats.' : 'No chats yet.'}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <h2 className="px-2 pb-1 text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                {group.label}
              </h2>
              <ul className="space-y-0.5">
                {group.items.map((c) => (
                  <li key={c.id}>
                    {renamingId === c.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={handleRenameKeyDown(c.id)}
                        onBlur={() => void commitRename(c.id)}
                        className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-input-strong)] px-2 py-1.5 text-sm text-[var(--text)] outline-none"
                      />
                    ) : (
                      <ConversationRow
                        conversation={c}
                        isActive={activeId === c.id}
                        onNavigate={onClose}
                        onRequestDelete={() => setConfirmDeleteId(c.id)}
                      >
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <button
                              aria-label={`More actions for ${c.title}`}
                              className="shrink-0 rounded p-1 text-[var(--text-muted)] opacity-100 hover:bg-[var(--surface-button-hover)] hover:text-[var(--text)] md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100"
                            >
                              <MoreHorizontal size={15} />
                            </button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content
                              align="start"
                              sideOffset={4}
                              className="radix-pop glass z-[70] min-w-36 rounded-lg border border-[var(--border-strong)] p-1 shadow-[var(--shadow-md)]"
                            >
                              <DropdownMenu.Item
                                onSelect={() => startRename(c)}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-muted)] outline-none data-[highlighted]:bg-[var(--surface-active)] data-[highlighted]:text-[var(--text)]"
                              >
                                <Pencil size={14} />
                                Rename
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                onSelect={() => setConfirmDeleteId(c.id)}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--danger)] outline-none data-[highlighted]:bg-red-500/10"
                              >
                                <Trash2 size={14} />
                                Delete
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      </ConversationRow>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-[var(--border)] px-2 py-2">
          {(isAdmin ? [...SECONDARY_LINKS, ...ADMIN_LINKS] : SECONDARY_LINKS).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={onClose}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                pathname === link.href
                  ? 'bg-[var(--surface-active)] text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
              }`}
            >
              <link.icon size={15} aria-hidden="true" />
              {link.label}
            </Link>
          ))}

          {/* Not a Link: opens the app-wide feedback panel in place rather
              than navigating away from whatever the user was stuck on,
              which is usually the context they want to describe. Lives in
              the nav (not a floating button) so it's reachable on mobile
              without colliding with the composer. */}
          <button
            onClick={() => {
              onClose()
              openFeedback()
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <MessageSquarePlus size={15} aria-hidden="true" />
            Help &amp; feedback
          </button>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] px-3 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] text-xs text-[var(--text-muted)]">
          <span className="min-w-0 truncate">{userEmail}</span>
          <span className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <SignOutButton />
          </span>
        </div>
      </motion.aside>

      <Dialog.Root
        open={confirmDeleteId !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmDeleteId(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="radix-overlay fixed inset-0 z-[70] bg-black/70" />
          <Dialog.Content className="radix-pop glass fixed top-1/2 left-1/2 z-[70] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border-strong)] p-5 shadow-[var(--shadow-md)]">
            <Dialog.Title className="text-sm font-medium text-[var(--text)]">
              Delete this chat?
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-[var(--text-muted)]">
              This can&apos;t be undone.
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2 text-sm">
              <Dialog.Close asChild>
                <button className="rounded-lg px-3 py-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-button-hover)]">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                onClick={() => confirmDeleteId && void handleDelete(confirmDeleteId)}
                className="rounded-lg bg-red-500/15 px-3 py-1.5 font-medium text-[var(--danger)] hover:bg-red-500/25"
              >
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
