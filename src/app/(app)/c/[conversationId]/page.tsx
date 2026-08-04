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
    // h-full, not a hardcoded "100vh minus header px" calc: that magic
    // number silently broke the moment the header's height changed (e.g.
    // wrapping on a narrow phone screen), pushing the composer below the
    // visible viewport. Relying on the (app) layout's own flex/dvh chain
    // (main is flex-1) means this always exactly fills whatever space is
    // actually available, however tall the header ends up being.
    <div className="mx-auto flex h-full max-w-2xl flex-col p-6">
      <h1 className="mb-4 shrink-0 text-lg font-bold">{conversation.title}</h1>
      <ChatWindow conversationId={conversationId} initialMessages={messages} />
    </div>
  )
}
