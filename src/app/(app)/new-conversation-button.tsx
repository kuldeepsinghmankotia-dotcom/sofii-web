'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { notifyConversationsChanged } from './sidebar'

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

    notifyConversationsChanged()
    router.push(`/c/${data.id}`)
  }

  return (
    <button
      onClick={handleCreate}
      disabled={loading}
      className="rounded-xl px-5 py-2.5 text-sm font-medium text-black shadow-[0_0_30px_rgba(139,92,246,0.35)] transition hover:shadow-[0_0_40px_rgba(34,211,238,0.4)] disabled:opacity-60"
      style={{ background: 'var(--accent-gradient)' }}
    >
      {loading ? 'Creating…' : '+ New conversation'}
    </button>
  )
}
