import type { Metadata } from 'next'
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
  description: 'Sofii — an AI assistant.'
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
