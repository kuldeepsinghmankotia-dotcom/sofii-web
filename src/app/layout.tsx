import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Orbitron } from 'next/font/google'
import { Toaster } from 'sonner'
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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${orbitron.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster
          theme="dark"
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
      </body>
    </html>
  )
}
