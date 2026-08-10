'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { authErrorMessage } from '@/lib/auth/error-message'

// Supabase's own default minimum. Enforced client-side too so the user
// finds out before a round-trip, not after.
const MIN_PASSWORD_LENGTH = 6

export default function UpdatePasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // null = still checking. The recovery link lands here only after
  // /auth/callback has exchanged the code for a session, so no session
  // means the link was invalid, already used, or expired — which is worth
  // saying plainly rather than showing a form that can only fail.
  const [hasSession, setHasSession] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createClient()
    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session))
    })
  }, [])

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Those two passwords don’t match.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(authErrorMessage(error.message))
      return
    }

    // The recovery session is already a real session, so there's no reason
    // to make someone sign in again with the password they just set.
    router.push('/')
    router.refresh()
  }

  if (hasSession === false) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--text)]">
        <div className="w-full max-w-sm space-y-4 p-8">
          <h1 className="text-2xl font-bold">This link has expired</h1>
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            Reset links are single-use and expire after about an hour. Request a fresh one and it
            will work.
          </p>
          <Link
            href="/forgot-password"
            className="inline-block rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--accent-gradient-text)]"
            style={{ background: 'var(--accent-gradient)' }}
          >
            Send a new link
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 p-8">
        <h1 className="text-2xl font-bold">Set a new password</h1>

        <input
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />

        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <button
          type="submit"
          disabled={loading || hasSession === null}
          className="w-full rounded-lg p-3 font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {loading ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </main>
  )
}
