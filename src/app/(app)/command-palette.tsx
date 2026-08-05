'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageSquarePlus, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { notifyConversationsChanged } from './sidebar'
import type { ConversationSummary } from '@/lib/db/conversations'

// Mounted once in app-shell.tsx, entirely self-contained (owns its own
// open/close state via a global keydown listener) rather than needing to be
// threaded through props — Cmd/Ctrl+K should work from anywhere in the app,
// not just when some particular page happens to render a trigger for it.
export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    // Deferred rather than called synchronously in the effect body — this
    // project's react-hooks/set-state-in-effect rule (React Compiler)
    // flags that as cascading-render-prone.
    queueMicrotask(() => setQuery(''))
    inputRef.current?.focus()

    const supabase = createClient()
    supabase
      .from('conversations')
      .select('id, title, updated_at')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setConversations(data)
      })
  }, [open])

  const filtered = query.trim()
    ? conversations.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()))
    : conversations

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

    setOpen(false)
    notifyConversationsChanged()
    router.push(`/c/${data.id}`)
  }

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return
    if (filtered.length > 0) {
      setOpen(false)
      router.push(`/c/${filtered[0].id}`)
    } else if (!query.trim()) {
      void handleNewChat()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 pt-24"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -6 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="glass w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border-strong)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4">
              <Search size={15} className="shrink-0 text-[var(--text-muted)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search chats..."
                className="w-full bg-transparent py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              <button
                onClick={() => void handleNewChat()}
                disabled={creating}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-60"
              >
                <MessageSquarePlus size={15} className="accent-text" />
                {creating ? 'Creating…' : 'New chat'}
              </button>
              {filtered.length === 0 && query && (
                <p className="px-3 py-4 text-sm text-[var(--text-muted)]">No matching chats.</p>
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setOpen(false)
                    router.push(`/c/${c.id}`)
                  }}
                  className="block w-full truncate rounded-lg px-3 py-2 text-left text-sm text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]"
                >
                  {c.title}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--text-muted)]">
              <span>↵ to jump in</span>
              <span>Esc to close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
