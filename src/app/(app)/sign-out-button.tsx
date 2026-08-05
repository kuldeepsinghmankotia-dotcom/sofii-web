'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Tooltip } from './tooltip'

export default function SignOutButton() {
  const router = useRouter()

  const handleSignOut = async (): Promise<void> => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  return (
    <Tooltip label="Sign out">
      <button
        onClick={handleSignOut}
        aria-label="Sign out"
        className="rounded p-1 hover:bg-white/10 hover:text-[var(--text)]"
      >
        <LogOut size={14} />
      </button>
    </Tooltip>
  )
}
