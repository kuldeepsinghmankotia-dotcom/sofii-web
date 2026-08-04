import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConversation } from '@/lib/db/conversations'
import { listMessages } from '@/lib/db/messages'
import ChatWindow from './chat-window'

export default async function ConversationPage({
  params
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params
  const supabase = await createClient()

  const conversation = await getConversation(supabase, conversationId)
  if (!conversation) notFound()

  const messages = await listMessages(supabase, conversationId)

  return (
    <div className="mx-auto flex h-[calc(100vh-73px)] max-w-2xl flex-col p-6">
      <h1 className="mb-4 text-lg font-bold">{conversation.title}</h1>
      <ChatWindow conversationId={conversationId} initialMessages={messages} />
    </div>
  )
}
