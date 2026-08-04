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
      className="rounded-lg border border-neutral-600 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-400 disabled:opacity-60"
    >
      {loading ? 'Disconnecting…' : 'Disconnect'}
    </button>
  )
}
