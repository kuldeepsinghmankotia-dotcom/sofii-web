'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { deleteCalendarConnection } from '@/lib/db/calendar'

export default function DisconnectButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleDisconnect = async (): Promise<void> => {
    setLoading(true)
    const supabase = createClient()
    await deleteCalendarConnection(supabase)
    setLoading(false)
    router.refresh()
  }

  return (
    <button
      onClick={handleDisconnect}
      disabled={loading}
      className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-60"
    >
      {loading ? 'Disconnecting…' : 'Disconnect'}
    </button>
  )
}
