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
    <div className="flex h-full flex-col p-4 sm:p-6">
      <h1 className="mx-auto mb-4 w-full max-w-3xl shrink-0 truncate text-sm font-medium text-[var(--text-muted)]">
        {conversation.title}
      </h1>
      <ChatWindow conversationId={conversationId} initialMessages={messages} />
    </div>
  )
}
