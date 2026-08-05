'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ConversationSummary } from '@/lib/db/conversations'
import SignOutButton from './sign-out-button'

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
  { href: '/memories', label: 'Memories', icon: '🧠' },
  { href: '/reminders', label: 'Reminders', icon: '⏰' },
  { href: '/documents', label: 'Documents', icon: '📄' },
  { href: '/calendar', label: 'Calendar', icon: '📅' }
]

type Group = { label: string; items: ConversationSummary[] }

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
  open,
  onClose
}: {
  initialConversations: ConversationSummary[]
  userEmail: string
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
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`glass fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col border-r border-[var(--border)] transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
          <Link
            href="/"
            onClick={onClose}
            className="font-display accent-text text-lg tracking-wide"
          >
            SOFII
          </Link>
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)] md:hidden"
          >
            ✕
          </button>
        </div>

        <div className="shrink-0 px-3 pb-3">
          <button
            onClick={handleNewChat}
            disabled={creating}
            className="relative flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-strong)] px-3 py-2.5 text-sm font-medium text-[var(--text)] transition hover:border-[var(--accent-a)] hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] disabled:opacity-60"
          >
            <span aria-hidden="true" className="accent-text text-base leading-none">
              +
            </span>
            {creating ? 'Creating…' : 'New chat'}
          </button>
        </div>

        <div className="accent-ring relative shrink-0 rounded-xl px-3 pb-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full rounded-lg border border-[var(--border)] bg-black/20 px-3 py-1.5 pr-12 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
            ⌘K
          </kbd>
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
                        className="w-full rounded-lg border border-[var(--border-strong)] bg-black/30 px-2 py-1.5 text-sm text-[var(--text)] outline-none"
                      />
                    ) : confirmDeleteId === c.id ? (
                      <div className="flex items-center justify-between gap-1 rounded-lg bg-white/5 px-2 py-1.5 text-sm">
                        <span className="truncate text-[var(--text-muted)]">Delete this chat?</span>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => void handleDelete(c.id)}
                            className="rounded px-1.5 py-0.5 text-[var(--danger)] hover:bg-red-500/10"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-white/10"
                          >
                            No
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`group relative flex items-center gap-1 rounded-lg py-1.5 pr-1 pl-3 text-sm ${
                          activeId === c.id ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        {activeId === c.id && (
                          <span
                            aria-hidden="true"
                            className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full"
                            style={{ background: 'var(--accent-gradient)' }}
                          />
                        )}
                        <Link
                          href={`/c/${c.id}`}
                          onClick={onClose}
                          className={`min-w-0 flex-1 truncate ${activeId === c.id ? 'text-[var(--text)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text)]'}`}
                        >
                          {c.title}
                        </Link>
                        <button
                          onClick={() => startRename(c)}
                          title="Rename"
                          className="shrink-0 rounded p-1 text-[var(--text-muted)] opacity-0 hover:bg-white/10 hover:text-[var(--text)] group-hover:opacity-100"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(c.id)}
                          title="Delete"
                          className="shrink-0 rounded p-1 text-[var(--text-muted)] opacity-0 hover:bg-red-500/10 hover:text-[var(--danger)] group-hover:opacity-100"
                        >
                          🗑
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-[var(--border)] px-2 py-2">
          {SECONDARY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={onClose}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                pathname === link.href
                  ? 'bg-white/[0.06] text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:bg-white/[0.04] hover:text-[var(--text)]'
              }`}
            >
              <span aria-hidden="true">{link.icon}</span>
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2.5 text-xs text-[var(--text-muted)]">
          <span className="min-w-0 truncate">{userEmail}</span>
          <span className="shrink-0">
            <SignOutButton />
          </span>
        </div>
      </aside>
    </>
  )
}
