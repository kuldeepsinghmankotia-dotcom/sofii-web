'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_THEME, THEME_STORAGE_KEY, type Theme } from './theme-constants'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {}
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

/**
 * Minimal replacement for next-themes.
 *
 * next-themes renders its no-flash script as a React <script> element,
 * which React 19 flags on every page load ("Encountered a script tag
 * while rendering React component") with no prop to disable it. This app
 * only ever needed a 2-way dark/light toggle writing one attribute, so
 * carrying a dependency that can't be quieted wasn't worth it.
 *
 * The no-flash half lives in layout.tsx as a raw <script> in <head>
 * (see THEME_INIT_SCRIPT) — it must run before first paint, which a React
 * effect by definition cannot. This provider only handles state after
 * hydration.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialised to the default rather than read from localStorage: this
  // renders on the server too, where localStorage doesn't exist, and a
  // mismatch between server and client output is a hydration error. The
  // effect below corrects it immediately after mount — and the inline
  // script has already set the real theme on <html>, so there's no
  // visible flash while that happens.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)

  useEffect(() => {
    // Deferred rather than called synchronously in the effect body — this
    // project's react-hooks/set-state-in-effect rule (React Compiler)
    // flags that as cascading-render-prone.
    queueMicrotask(() => {
      const stored = document.documentElement.getAttribute('data-theme')
      if (stored === 'light' || stored === 'dark') setThemeState(stored)
    })
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Private browsing / storage disabled — the theme still applies for
      // this session, it just won't persist. Not worth surfacing.
    }
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
