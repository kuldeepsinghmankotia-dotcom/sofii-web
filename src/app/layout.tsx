import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Orbitron } from 'next/font/google'
import AppToaster from './app-toaster'
import { ThemeProvider } from './theme-provider'
// Imported from the plain (non-'use client') constants module on purpose —
// see theme-constants.ts for why importing these from the provider itself
// silently emitted `undefined` into the script below.
import { DEFAULT_THEME, THEME_STORAGE_KEY } from './theme-constants'
import './globals.css'

// Runs before first paint, which is the entire point: reading the saved
// theme in a React effect would mean the page paints in the default theme
// first and then visibly snaps to the other one. Kept deliberately tiny
// and wrapped in try/catch — localStorage throws in some privacy modes,
// and a failure here must fall back to the default rather than leave the
// page unstyled.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});document.documentElement.setAttribute('data-theme',t==='light'||t==='dark'?t:${JSON.stringify(
  DEFAULT_THEME
)})}catch(e){document.documentElement.setAttribute('data-theme',${JSON.stringify(
  DEFAULT_THEME
)})}})()`

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin']
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin']
})

// Wordmark/brand-only display face — a distinct register from the Geist
// body/code faces, reserved for the "Sofii" mark and section eyebrows, not
// body text (its letterforms get illegible at paragraph sizes).
const orbitron = Orbitron({
  variable: '--font-orbitron',
  subsets: ['latin'],
  weight: ['500', '700']
})

export const metadata: Metadata = {
  title: 'Sofii',
  description: 'Sofii — an AI assistant.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Sofii'
  }
}

// viewportFit: 'cover' lets the app draw edge-to-edge under the iPhone
// notch/Dynamic Island and home indicator (matching Gemini/Copilot's
// full-bleed mobile look) instead of Safari letterboxing the page to the
// safe area — the safe-area-inset-* env() padding used across the app
// (mobile header, sidebar, composer) only has anything to pad against once
// this is set. themeColor/colorScheme match the browser chrome (status bar,
// pull-to-refresh spinner) to the app's own near-black background rather
// than leaving it default white.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#05060b',
  colorScheme: 'dark'
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning is required because THEME_INIT_SCRIPT sets
    // data-theme on <html> before React hydrates (so there's no flash of
    // the wrong theme) — an intentional server/client difference that
    // would otherwise be reported as a mismatch.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${orbitron.variable} h-full antialiased`}
    >
      <head>
        {/* Must be raw HTML inside an explicit <head>, not next/script and
        not an unwrapped <script>: it has to execute before the first paint,
        and anything deferred to hydration is by definition too late to
        prevent a flash.

        The explicit <head> is load-bearing — dropping it to let React hoist
        the tag instead was measured, and React emitted the script *inside*
        <body> after the content div, i.e. after first paint. React's
        dev-only "script tags never execute when rendering on the client"
        warning is the accepted cost of this; it does not fire in a
        production build (verified), and a dev console warning is a far
        cheaper problem than a theme flash on every real page load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/* Dark is the app's primary identity — the default is dark (not
        the OS setting) so nobody's system light-mode preference silently
        changes Sofii's look on first visit; light is an explicit opt-in
        via the toggle. A 2-way toggle, not a 3-way light/dark/system
        picker. */}
        <ThemeProvider>
          {children}
          <AppToaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
