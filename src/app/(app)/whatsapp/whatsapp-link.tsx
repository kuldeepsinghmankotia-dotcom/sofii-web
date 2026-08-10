'use client'

import { useState } from 'react'
import { Copy, Check, Loader2, Smartphone, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

interface LinkRow {
  phone: string
  display_name: string | null
  linked_at: string
}

// Turns a bare E.164 string into something readable. Deliberately light —
// no locale library for what is only ever shown back to the person who owns
// the number and already knows it.
function formatPhone(phone: string): string {
  if (phone.length === 12 && phone.startsWith('91')) {
    return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`
  }
  return `+${phone}`
}

export default function WhatsAppLink({
  available,
  initialLinks,
  signedIn
}: {
  available: boolean
  initialLinks: LinkRow[]
  signedIn: boolean
}) {
  const [links, setLinks] = useState(initialLinks)
  const [code, setCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const requestCode = async (): Promise<void> => {
    setLoading(true)
    try {
      const response = await fetch('/api/whatsapp/link-code', { method: 'POST' })
      if (!response.ok) throw new Error(await response.text())
      const { code: newCode } = (await response.json()) as { code: string }
      setCode(newCode)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create a code')
    } finally {
      setLoading(false)
    }
  }

  const copy = async (): Promise<void> => {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const unlink = async (phone: string): Promise<void> => {
    const supabase = createClient()
    const { error } = await supabase.from('whatsapp_links').delete().eq('phone', phone)
    if (error) {
      toast.error('Could not unlink that number')
      return
    }
    setLinks((prev) => prev.filter((l) => l.phone !== phone))
    toast.success('Number unlinked')
  }

  if (!available) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm leading-relaxed text-[var(--text-muted)]">
        WhatsApp isn&apos;t switched on yet. It&apos;s built and waiting on the phone number being
        approved — this page will start working the moment it is.
      </div>
    )
  }

  if (!signedIn) return null

  return (
    <div className="space-y-6">
      {links.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-[var(--text)]">Connected numbers</h2>
          <ul className="space-y-2">
            {links.map((link) => (
              <li
                key={link.phone}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
              >
                <Smartphone size={16} className="accent-icon shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[var(--text)]">{formatPhone(link.phone)}</p>
                  {link.display_name && (
                    <p className="truncate text-xs text-[var(--text-muted)]">{link.display_name}</p>
                  )}
                </div>
                <button
                  onClick={() => void unlink(link.phone)}
                  aria-label={`Unlink ${formatPhone(link.phone)}`}
                  className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--danger)]"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--text)]">
          {links.length > 0 ? 'Connect another number' : 'Connect your number'}
        </h2>

        {code ? (
          <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] p-4">
            <p className="mb-3 text-sm leading-relaxed text-[var(--text-muted)]">
              Send this code to Sofii on WhatsApp from the number you want to connect. It expires in
              15 minutes.
            </p>
            <div className="flex items-center gap-2">
              <code className="font-display flex-1 rounded-lg bg-[var(--bg-elevated)] px-4 py-3 text-center text-2xl tracking-[0.3em] text-[var(--text)]">
                {code}
              </code>
              <button
                onClick={() => void copy()}
                aria-label="Copy code"
                className="rounded-lg border border-[var(--border)] p-3 text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                {copied ? <Check size={16} className="accent-icon" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => void requestCode()}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
            style={{ background: 'var(--accent-gradient)' }}
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Smartphone size={15} />}
            Get a linking code
          </button>
        )}
      </section>
    </div>
  )
}
