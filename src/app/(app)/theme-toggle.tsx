'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { Tooltip } from './tooltip'

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // next-themes intentionally resolves the real theme client-side only
  // (that's what avoids a flash of the wrong theme on load) — resolvedTheme
  // is undefined on the server and on the client's first render, so
  // rendering an icon based on it before mount would itself be a
  // server/client mismatch. Deferred via queueMicrotask per this project's
  // react-hooks/set-state-in-effect convention.
  useEffect(() => {
    queueMicrotask(() => setMounted(true))
  }, [])

  if (!mounted) return <div className="h-6 w-6" aria-hidden="true" />

  const isLight = resolvedTheme === 'light'

  return (
    <Tooltip label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}>
      <button
        onClick={() => setTheme(isLight ? 'dark' : 'light')}
        aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
        className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-button-hover)] hover:text-[var(--text)]"
      >
        {isLight ? <Moon size={14} /> : <Sun size={14} />}
      </button>
    </Tooltip>
  )
}
