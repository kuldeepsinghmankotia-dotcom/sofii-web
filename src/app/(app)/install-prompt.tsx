'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Share, Plus, X, Download } from 'lucide-react'

// Encourages installing Sofii to the Home Screen.
//
// Worth prompting for rather than leaving to chance, because installation
// is not only about convenience: on iOS, web push is delivered *only* to an
// installed app. A user who never installs can never receive a reminder or
// a briefing, no matter how many times they grant notification permission.
//
// The two platforms need entirely different treatment. Android fires
// `beforeinstallprompt` and lets the page trigger the real system dialog.
// iOS fires nothing and exposes no API at all — the only route is the user
// manually choosing Share → Add to Home Screen, so all we can do is show
// them where it is.

const DISMISSED_KEY = 'sofii:install-dismissed'

// Long enough that dismissing feels respected, short enough to ask again
// once someone is actually using the app.
const DISMISS_DAYS = 30

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS predates display-mode and exposes this instead.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS reports as Macintosh, so touch support is the distinguishing
  // signal there.
  return (
    /iphone|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return false
    return Date.now() - Number(raw) < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    // Private mode can throw on localStorage; showing the prompt is the
    // harmless direction to fail.
    return false
  }
}

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false)
  const [platform, setPlatform] = useState<'ios' | 'android'>('android')
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    // Already installed: nothing to ask for.
    if (isStandalone() || wasRecentlyDismissed()) return

    if (isIos()) {
      // Nothing to wait for on iOS — there is no event. Delayed so it does
      // not land on top of a first impression.
      const timer = setTimeout(() => {
        setPlatform('ios')
        setVisible(true)
      }, 20_000)
      return () => clearTimeout(timer)
    }

    const onBeforeInstall = (event: Event): void => {
      // Suppress Chrome's own mini-infobar so this is the only prompt shown.
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
      setPlatform('android')
      setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  const dismiss = (): void => {
    setVisible(false)
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    } catch {
      // Not worth surfacing; the prompt simply reappears next visit.
    }
  }

  const install = async (): Promise<void> => {
    if (!deferred) return
    await deferred.prompt()
    // The event is single-use, whatever the user chose.
    setDeferred(null)
    setVisible(false)
    const { outcome } = await deferred.userChoice
    if (outcome === 'dismissed') dismiss()
  }

  if (!visible) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        role="dialog"
        aria-label="Install Sofii"
        // Sits above the composer, clear of the iOS home indicator.
        className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[65] mx-auto max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-md)]"
      >
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute top-3 right-3 rounded-lg p-1 text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <X size={16} />
        </button>

        <div className="mb-2 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-6 w-6 shrink-0 rounded-full"
            style={{ background: 'var(--accent-gradient)', boxShadow: 'var(--avatar-glow-sm)' }}
          />
          <p className="font-display accent-text text-sm tracking-wide">
            {/* "Home screen" is iOS's own wording for the gesture being
                described. Chrome fires beforeinstallprompt on desktop too,
                where that phrasing makes no sense. */}
            {platform === 'ios' ? 'Add Sofii to your home screen' : 'Install Sofii'}
          </p>
        </div>

        {platform === 'ios' ? (
          <>
            <p className="mb-3 text-sm leading-relaxed text-[var(--text-muted)]">
              Opens like an app, and it&apos;s the only way iPhone will let me send you reminders.
            </p>
            <ol className="space-y-1.5 text-sm text-[var(--text-muted)]">
              <li className="flex items-center gap-2">
                <Share size={14} className="accent-icon shrink-0" aria-hidden="true" />
                Tap Share in the Safari toolbar
              </li>
              <li className="flex items-center gap-2">
                <Plus size={14} className="accent-icon shrink-0" aria-hidden="true" />
                Choose &ldquo;Add to Home Screen&rdquo;
              </li>
            </ol>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm leading-relaxed text-[var(--text-muted)]">
              Opens in its own window, and lets me send you reminders.
            </p>
            <button
              onClick={() => void install()}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--accent-gradient-text)]"
              style={{ background: 'var(--accent-gradient)' }}
            >
              <Download size={15} />
              Install
            </button>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
