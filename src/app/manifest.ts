import type { MetadataRoute } from 'next'

// Auto-discovered by Next (app/manifest.ts) and wired into <head> as
// rel="manifest" — this is what lets "Add to Home Screen" install Sofii as
// a standalone app (own icon, no browser chrome/URL bar) instead of just
// bookmarking the page. Icons are served by manifest-icon/route.tsx rather
// than static files so the brand's gradient orb (defined once, in
// globals.css/--accent-gradient) stays the single source of truth instead
// of a hand-exported PNG going stale next to it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sofii',
    short_name: 'Sofii',
    description: 'Sofii — an AI assistant.',
    start_url: '/',
    display: 'standalone',
    background_color: '#05060b',
    theme_color: '#05060b',
    icons: [
      { src: '/manifest-icon?size=192', sizes: '192x192', type: 'image/png' },
      { src: '/manifest-icon?size=512', sizes: '512x512', type: 'image/png' },
      {
        src: '/manifest-icon?size=192&maskable=1',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable'
      },
      {
        src: '/manifest-icon?size=512&maskable=1',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  }
}
