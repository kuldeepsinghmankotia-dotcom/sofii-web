'use client'

import { useEffect, useState } from 'react'

// Mirrors Tailwind's `md` breakpoint (768px) — used by sidebar.tsx and
// app-shell.tsx to gate swipe-gesture behavior to the same widths where the
// sidebar is already an overlay rather than a static column (`md:static`),
// since dragging/swiping only makes sense for the overlay presentation.
export const MOBILE_QUERY = '(max-width: 767px)'

// Starts false (matching what SSR renders, since window isn't available
// server-side) rather than reading matchMedia synchronously via a lazy
// initializer — that alternative was tried first and reintroduced a real
// hydration mismatch: framer-motion's `drag` prop renders different
// attributes/styles (draggable, touch-action, user-select) depending on
// whether it's truthy, so a client-only "correct" initial value differing
// from the false SSR rendered would make the very first client render not
// match the server output. queueMicrotask defers the correction out of the
// mount effect's synchronous body (this project's react-hooks/set-state-in-effect
// rule flags synchronous setState-in-effect as cascading-render-prone) while
// still resolving before the browser's next paint, so real mobile devices
// never actually see the one-tick-stale false value.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    queueMicrotask(() => setIsMobile(mql.matches))
    const handleChange = (e: MediaQueryListEvent): void => setIsMobile(e.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  return isMobile
}
