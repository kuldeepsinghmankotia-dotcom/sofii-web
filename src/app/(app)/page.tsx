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

// The conversation list itself lives in the persistent sidebar
// (sidebar.tsx) — this page is the "nothing selected yet" landing state,
// the same role ChatGPT/Gemini's blank composer screen plays: a centered
// composer plus a few starting points, not just a bare "new chat" button.
export default function HomePage() {
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
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div
        aria-hidden="true"
        className="h-16 w-16 rounded-full opacity-90 blur-[1px]"
        style={{
          background: 'var(--accent-gradient)',
          boxShadow: 'var(--avatar-glow-lg)'
        }}
      />
      <h1 className="font-display accent-text text-2xl tracking-wide">SOFII</h1>
      <p className="max-w-sm text-sm text-[var(--text-muted)]">
        Ask anything, or pick a starting point below.
      </p>

      <div className="accent-ring flex w-full max-w-xl items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-2">
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

      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.04 }}
            onClick={() => void start(s)}
            disabled={creating}
            className="rounded-xl border border-[var(--border)] px-4 py-3 text-left text-sm text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-60"
          >
            {s}
          </motion.button>
        ))}
      </div>
    </div>
  )
}
