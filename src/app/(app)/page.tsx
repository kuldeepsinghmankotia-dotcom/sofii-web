import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listConversations } from '@/lib/db/conversations'
import NewConversationButton from './new-conversation-button'

export default async function ConversationListPage() {
  const supabase = await createClient()
  const conversations = await listConversations(supabase)

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">Your conversations</h1>
        <NewConversationButton />
      </div>

      {conversations.length === 0 && (
        <p className="text-neutral-400">No conversations yet — start one above.</p>
      )}

      <ul className="space-y-2">
        {conversations.map((c) => (
          <li key={c.id}>
            <Link
              href={`/c/${c.id}`}
              className="block rounded-lg bg-neutral-900 p-4 hover:bg-neutral-800"
            >
              {c.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
