'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../theme-provider'
import { Tooltip } from './tooltip'

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // The real theme is only known client-side (it's read from localStorage
  // by the inline script in layout.tsx, before React runs), so the
  // provider's server render always reports the default. Rendering an
  // icon from that before mount would itself be a server/client mismatch,
  // so a same-size placeholder holds the space until then — which also
  // keeps the toolbar from shifting. Deferred via queueMicrotask per this
  // project's react-hooks/set-state-in-effect convention.
  useEffect(() => {
    queueMicrotask(() => setMounted(true))
  }, [])

  if (!mounted) return <div className="h-6 w-6" aria-hidden="true" />

  const isLight = theme === 'light'

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
