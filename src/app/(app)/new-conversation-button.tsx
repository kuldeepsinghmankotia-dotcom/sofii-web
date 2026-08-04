'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function NewConversationButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleCreate = async (): Promise<void> => {
    setLoading(true)

    const supabase = createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: user.id })
      .select('id')
      .single()

    setLoading(false)

    if (error || !data) return

    router.push(`/c/${data.id}`)
  }

  return (
    <button
      onClick={handleCreate}
      disabled={loading}
      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium disabled:opacity-60"
    >
      {loading ? 'Creating…' : '+ New conversation'}
    </button>
  )
}
