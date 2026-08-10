'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    // Routed through the existing /auth/callback handler, which exchanges
    // the recovery code for a session before landing on the update form —
    // without that exchange, updateUser() on the next page would have no
    // session to act on.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSent(true)
  }

  if (sent) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--text)]">
        <div className="w-full max-w-sm space-y-4 p-8">
          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            If an account exists for <span className="text-[var(--text)]">{email}</span>, a reset
            link is on its way. It expires in about an hour.
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            Nothing arrived? Check spam, or{' '}
            <button
              onClick={() => setSent(false)}
              className="text-[var(--accent-a)] underline"
            >
              try a different email
            </button>
            .
          </p>
          <Link href="/sign-in" className="block text-sm text-[var(--accent-a)] underline">
            Back to sign in
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 p-8">
        <h1 className="text-2xl font-bold">Reset your password</h1>
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">
          Enter your email and we&apos;ll send you a link to set a new one.
        </p>

        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg p-3 font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {loading ? 'Sending…' : 'Send reset link'}
        </button>

        <p className="text-sm text-[var(--text-muted)]">
          Remembered it?{' '}
          <Link href="/sign-in" className="text-[var(--accent-a)] underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  )
}
