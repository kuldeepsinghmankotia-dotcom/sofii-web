import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Orbitron } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import AppToaster from './app-toaster'
import './globals.css'

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
    // suppressHydrationWarning on <html> is required by next-themes: it
    // sets the data-theme attribute via an inline script that runs before
    // React hydrates (so there's no flash of the wrong theme), which would
    // otherwise be flagged as a server/client mismatch even though it's
    // intentional.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${orbitron.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* Dark is the app's primary identity — defaultTheme="dark" (not
        "system") so nobody's OS light-mode preference silently changes
        Sofii's look on first visit; light is an explicit opt-in via the
        toggle, not a default. enableSystem is off to match — this is a
        2-way toggle, not a 3-way light/dark/system picker. */}
        <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem={false}>
          {children}
          <AppToaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
