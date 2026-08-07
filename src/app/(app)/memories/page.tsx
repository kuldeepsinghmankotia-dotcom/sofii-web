import { Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { listMemories } from '@/lib/db/memories'
import { PageHeader } from '../page-header'
import MemoryList from './memory-list'

export default async function MemoriesPage() {
  const supabase = await createClient()
  const memories = await listMemories(supabase)

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader icon={Sparkles} title="Memories" />
      <MemoryList initialMemories={memories} />
    </div>
  )
}
