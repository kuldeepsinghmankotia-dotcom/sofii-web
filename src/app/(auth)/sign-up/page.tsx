'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { authError } from '@/lib/auth/error-message'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
    })

    setLoading(false)

    if (error) {
      setError(authError(error))
      return
    }

    setMessage('Check your email to confirm your account.')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 p-8">
        <h1 className="text-2xl font-bold">Create your Sofii account</h1>

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
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        {message && <p className="text-sm text-emerald-400">{message}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg p-3 font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {loading ? 'Creating account…' : 'Sign up'}
        </button>

        <p className="text-sm text-[var(--text-muted)]">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-[var(--accent-a)] underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  )
}
