'use client'

import { useTheme } from './theme-provider'
import { Toaster } from 'sonner'

// Split out from layout.tsx because useTheme() needs a client component —
// the toast's own background/border/text already come from CSS variables
// (theme-aware via globals.css), but Sonner's `theme` prop also drives its
// built-in icon/close-button colors, which those inline styles don't
// reach.
export default function AppToaster() {
  const { theme } = useTheme()

  return (
    <Toaster
      theme={theme === 'light' ? 'light' : 'dark'}
      position="bottom-center"
      toastOptions={{
        className: 'glass',
        style: {
          background: 'var(--bg-glass)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text)',
          borderRadius: 'var(--radius-lg)'
        }
      }}
    />
  )
}
