'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Brain, FileText, Mic, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { notifyConversationsChanged } from './sidebar'

// The demo prompt is the whole point of the tour: rather than *telling*
// someone Sofii remembers, it has them state a fact, so the very next
// conversation can prove it. A claim you can immediately verify is worth
// more than three screens of feature copy.
const DEMO_PROMPT =
  "I'm planning a trip to Lisbon in October, my budget is around 1,800 euros, and I want to focus on food and architecture rather than nightlife."

const STEPS = [
  {
    icon: Brain,
    title: 'I remember across conversations',
    body: "Not just this chat — every one. Ask me next week what your Lisbon budget was and I'll know, and I'll show you exactly where I got it from."
  },
  {
    icon: FileText,
    title: 'Give me things to read',
    body: 'Upload a PDF, spreadsheet, slide deck or photo, or paste a link. It all becomes searchable in conversation — ask about it in plain language.'
  },
  {
    icon: Mic,
    title: 'Or just talk to me',
    body: 'Tap the mic and speak. Turn on SOFII mode and you can skip the tapping entirely — say "Sofii" and start talking, in whatever language you like.'
  }
]

/**
 * First-run tour. Shown once, then never again (profiles.onboarded_at).
 *
 * Ends by actually starting a conversation with a concrete prompt rather
 * than dropping the user on an empty composer, which is where new users
 * were previously stranded: the landing page promises memory, and then
 * the product gave them a blank box and no way to see it.
 */
export default function Onboarding() {
  const [step, setStep] = useState(0)
  const [starting, setStarting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const router = useRouter()
  const reducedMotion = useReducedMotion()

  const markDone = async (): Promise<void> => {
    const supabase = createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) return
    // Best-effort: if this write fails the worst case is seeing the tour
    // once more, which is far better than blocking the user behind it.
    await supabase
      .from('profiles')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('id', user.id)
  }

  const skip = async (): Promise<void> => {
    setDismissed(true)
    await markDone()
    router.refresh()
  }

  const start = async (): Promise<void> => {
    if (starting) return
    setStarting(true)

    const supabase = createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      setStarting(false)
      return
    }

    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: user.id })
      .select('id')
      .single()

    await markDone()

    if (error || !data) {
      // Still dismiss: a failed demo conversation shouldn't trap someone
      // in the tour with no way forward.
      setStarting(false)
      setDismissed(true)
      router.refresh()
      return
    }

    setDismissed(true)
    notifyConversationsChanged()
    router.push(`/c/${data.id}?prefill=${encodeURIComponent(DEMO_PROMPT)}`)
  }

  if (dismissed) return null

  const isLast = step === STEPS.length - 1
  const current = STEPS[step]

  return (
    <AnimatePresence>
      <motion.div
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Sofii"
      >
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          // Solid --bg-elevated rather than the app's translucent `glass`
          // treatment: this sits over a busy composer/sidebar, and the
          // frosted look left the copy genuinely hard to read against the
          // text bleeding through behind it.
          className="w-full max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-md)]"
        >
          <div className="mb-4 flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-6 w-6 rounded-full"
              style={{ background: 'var(--accent-gradient)', boxShadow: 'var(--avatar-glow-sm)' }}
            />
            <span className="font-display accent-text text-sm tracking-wide">SOFII</span>
          </div>

          <current.icon size={20} className="accent-icon mb-3" aria-hidden="true" />
          <h2 className="mb-2 text-lg font-semibold text-[var(--text)]">{current.title}</h2>
          <p className="mb-5 text-sm leading-relaxed text-[var(--text-muted)]">{current.body}</p>

          {isLast && (
            <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text)]">
                <Sparkles size={12} className="accent-icon" aria-hidden="true" />
                Let&apos;s prove the memory part
              </p>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                I&apos;ll start you off with this. Later, open a brand-new chat and ask what your
                budget was — you&apos;ll see me find it.
              </p>
              <p className="mt-2 text-xs italic text-[var(--text-muted)]">&ldquo;{DEMO_PROMPT}&rdquo;</p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex gap-1.5" aria-hidden="true">
              {STEPS.map((s, i) => (
                <span
                  key={s.title}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? 'w-5 bg-[var(--accent-a)]' : 'w-1.5 bg-[var(--border-strong)]'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void skip()}
                className="rounded-lg px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                Skip
              </button>
              <button
                onClick={() => (isLast ? void start() : setStep((prev) => prev + 1))}
                disabled={starting}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
                style={{ background: 'var(--accent-gradient)' }}
              >
                {isLast ? (starting ? 'Starting…' : 'Try it') : 'Next'}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
