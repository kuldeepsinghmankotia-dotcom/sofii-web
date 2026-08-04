import { createClient } from '@/lib/supabase/server'
import { listMemories } from '@/lib/db/memories'
import MemoryList from './memory-list'

export default async function MemoriesPage() {
  const supabase = await createClient()
  const memories = await listMemories(supabase)

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-bold">🧠 Memories</h1>
      <MemoryList initialMemories={memories} />
    </div>
  )
}
