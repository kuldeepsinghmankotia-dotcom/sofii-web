'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { toast } from 'sonner'
import { Bug, HelpCircle, Lightbulb, X } from 'lucide-react'

type Kind = 'suggestion' | 'bug' | 'help'

// Same window-event pattern the sidebar already uses for
// conversation-changed: the trigger lives in the sidebar nav (so it works
// on mobile, where a floating button would collide with the composer),
// while the panel is mounted app-wide in app-shell. A shared event is
// simpler than threading state through both.
const OPEN_FEEDBACK_EVENT = 'sofii:open-feedback'

export function openFeedback(): void {
  window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT))
}

const KINDS: { value: Kind; label: string; icon: typeof Lightbulb; placeholder: string }[] = [
  {
    value: 'suggestion',
    label: 'Idea',
    icon: Lightbulb,
    placeholder: "What would make Sofii more useful for you?"
  },
  {
    value: 'bug',
    label: 'Bug',
    icon: Bug,
    placeholder: 'What happened, and what did you expect instead?'
  },
  {
    value: 'help',
    label: 'Help',
    icon: HelpCircle,
    placeholder: "What are you trying to do? I'll get back to you."
  }
]

// Quick answers to the questions new users actually ask, shown inline
// rather than behind a docs link — someone confused enough to open a help
// box will not go read a separate site.
const TIPS: { q: string; a: string }[] = [
  {
    q: 'Does Sofii remember past conversations?',
    a: 'Yes. It searches your earlier conversations automatically, and every reply shows a "Why this answer" panel listing exactly what it drew on.'
  },
  {
    q: 'Can I talk to it instead of typing?',
    a: 'Tap the mic to speak, or turn on SOFII mode in the toolbar and just say "Sofii" — no clicking. Replies can be spoken back in ~30 languages.'
  },
  {
    q: 'What can I upload?',
    a: 'PDF, Word, PowerPoint, Excel, CSV, Markdown, text, and images (which get read via OCR). You can also paste a web page URL. Everything becomes searchable in chat.'
  },
  {
    q: 'What is Branch for?',
    a: 'It forks a conversation from any message into a new thread, so you can explore a different direction without losing the original.'
  }
]

/**
 * Floating help + feedback entry point, mounted app-wide.
 *
 * Combines "get unstuck" and "tell us something" in one surface on
 * purpose: a user who can't find how to do something and a user with an
 * idea both reach for the same affordance, and splitting them into two
 * buttons means neither gets found.
 */
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('suggestion')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const pathname = usePathname()
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    const onOpen = (): void => setOpen(true)
    window.addEventListener(OPEN_FEEDBACK_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, onOpen)
  }, [])

  const active = KINDS.find((k) => k.value === kind)!

  const submit = async (): Promise<void> => {
    const trimmed = message.trim()
    if (!trimmed || sending) return

    setSending(true)
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, message: trimmed, pagePath: pathname })
      })
      if (!response.ok) throw new Error(await response.text())

      setMessage('')
      setOpen(false)
      toast.success(
        kind === 'help' ? "Sent — I'll get back to you." : 'Thanks — this goes straight to the team.'
      )
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      toast.error(`Could not send: ${detail}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            role="dialog"
            aria-label="Help and feedback"
            className="glass fixed bottom-4 left-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-[var(--border-strong)] p-4 shadow-[var(--shadow-md)] md:bottom-6 md:left-6 md:translate-x-0"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text)]">Help &amp; feedback</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close help and feedback"
                className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-button-hover)] hover:text-[var(--text)]"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mb-3 flex gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                    kind === k.value
                      ? 'border-[var(--accent-a)] text-[var(--accent-a)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  <k.icon size={12} aria-hidden="true" />
                  {k.label}
                </button>
              ))}
            </div>

            {kind === 'help' && (
              <div className="mb-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-2.5">
                {TIPS.map((tip) => (
                  <details key={tip.q} className="text-xs">
                    <summary className="cursor-pointer text-[var(--text)] marker:text-[var(--text-muted)]">
                      {tip.q}
                    </summary>
                    <p className="mt-1 leading-relaxed text-[var(--text-muted)]">{tip.a}</p>
                  </details>
                ))}
              </div>
            )}

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={active.placeholder}
              rows={4}
              className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-input)] p-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
            />

            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-[var(--text-muted)]">
                Sent with the page you&apos;re on
              </span>
              <button
                onClick={() => void submit()}
                disabled={sending || !message.trim()}
                className="rounded-lg px-3.5 py-1.5 text-xs font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
                style={{ background: 'var(--accent-gradient)' }}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
