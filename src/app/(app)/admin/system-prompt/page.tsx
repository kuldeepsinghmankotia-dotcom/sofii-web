import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getOwnRole } from '@/lib/db/profiles'
import { getActiveSystemPrompt } from '@/lib/db/system-prompt'
import { PageHeader } from '../../page-header'
import SystemPromptForm from './system-prompt-form'

// Self-contained auth check (same style as (app)/layout.tsx's own
// getUser() gate) rather than a new middleware branch — the API route this
// form posts to re-checks the role independently, so this redirect is a UX
// nicety, not the actual security boundary.
export default async function SystemPromptAdminPage() {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const role = await getOwnRole(supabase, user.id)
  if (role !== 'admin') redirect('/')

  const content = await getActiveSystemPrompt(supabase)

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader
        icon={Sparkles}
        title="System Prompt"
        description="Edit Sofii's persona and behavior instructions. Changes apply to every new chat reply immediately — no deploy needed."
      />
      <SystemPromptForm initialContent={content} />
    </div>
  )
}
