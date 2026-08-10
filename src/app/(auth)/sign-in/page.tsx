'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { authErrorMessage } from '@/lib/auth/error-message'

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [linkFailed, setLinkFailed] = useState(false)
  const [loading, setLoading] = useState(false)

  // /auth/callback bounces here when it can't exchange a code — most
  // often an expired or already-used password-reset link. Without this the
  // user landed on a plain sign-in form with no explanation of why their
  // link didn't work, and no route to a fresh one.
  //
  // Read from window.location rather than useSearchParams to avoid
  // requiring a Suspense boundary around this whole page just to read one
  // optional param.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error')) {
      queueMicrotask(() => setLinkFailed(true))
    }
  }, [])

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)

    if (error) {
      setError(authErrorMessage(error.message))
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 p-8">
        <h1 className="text-2xl font-bold">Sign in to Sofii</h1>

        {linkFailed && (
          <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] p-3 text-sm leading-relaxed text-[var(--text-muted)]">
            That link didn&apos;t work — reset links are single-use and expire after about an hour.{' '}
            <Link href="/forgot-password" className="text-[var(--accent-a)] underline">
              Request a new one
            </Link>
            .
          </div>
        )}

        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />

        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />

        {/* Sits directly under the password field, where someone who just
            failed to remember it is already looking. */}
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-[var(--text-muted)] hover:text-[var(--accent-a)]">
            Forgot password?
          </Link>
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg p-3 font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-sm text-[var(--text-muted)]">
          Don&apos;t have an account?{' '}
          <Link href="/sign-up" className="text-[var(--accent-a)] underline">
            Sign up
          </Link>
        </p>
      </form>
    </main>
  )
}
