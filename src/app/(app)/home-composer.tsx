'use client'

import { useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { notifyConversationsChanged } from './sidebar'

const SUGGESTIONS = [
  'Explain quantum computing simply',
  'Draft a polite follow-up email',
  'Plan a 3-day trip itinerary',
  'Help me debug an error message'
]

/**
 * The landing composer — extracted from the old page.tsx so the page
 * itself can be a Server Component that loads the catch-up panel, while
 * this half keeps the client-side interactivity it needs.
 */
export default function HomeComposer({ compact = false }: { compact?: boolean }) {
  const [input, setInput] = useState('')
  const [creating, setCreating] = useState(false)
  const router = useRouter()

  const start = async (text: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || creating) return
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

    notifyConversationsChanged()
    // chat-window.tsx picks this up on mount and sends it as the first
    // message, then strips the param — see its prefill effect.
    router.push(`/c/${data.id}?prefill=${encodeURIComponent(trimmed)}`)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') void start(input)
  }

  return (
    <div className="w-full">
      <div className="accent-ring flex w-full items-center gap-2 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-input)] p-2 shadow-[var(--shadow-md)]">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Sofii..."
          className="flex-1 bg-transparent p-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <button
          onClick={() => void start(input)}
          disabled={creating}
          aria-label="Send message"
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {creating ? '…' : <Send size={14} />}
        </button>
      </div>

      {/* Suggestions are noise next to a real catch-up panel — someone
          returning after two weeks needs their own pending items, not
          "explain quantum computing". */}
      {!compact && (
        <div className="mt-3 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s, i) => (
            <motion.button
              key={s}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.04 }}
              onClick={() => void start(s)}
              disabled={creating}
              className="rounded-xl border border-[var(--border)] px-4 py-3 text-left text-sm text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-60"
            >
              {s}
            </motion.button>
          ))}
        </div>
      )}
    </div>
  )
}
