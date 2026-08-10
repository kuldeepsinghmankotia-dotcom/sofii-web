'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 p-8">
        <h1 className="text-2xl font-bold">Sign in to Sofii</h1>

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
