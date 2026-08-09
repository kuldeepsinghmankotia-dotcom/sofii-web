import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConversationByShareToken } from '@/lib/db/conversations'
import { listMessages } from '@/lib/db/messages'
import { AssistantContent } from '../../(app)/c/[conversationId]/message-content'

// Public, unauthenticated route — outside the (app) route group entirely,
// so it gets none of AppShell's sidebar/composer/auth-gate. Uses the
// service-role admin client (src/lib/supabase/admin.ts) rather than the
// normal request-scoped one, since an anonymous visitor has no session for
// RLS to key off — safe here specifically because the lookup filters by
// the exact share token, never by anything guessable.
export default async function SharedConversationPage({
  params
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createAdminClient()

  const conversation = await getConversationByShareToken(supabase, token)
  if (!conversation) notFound()

  const messages = await listMessages(supabase, conversation.id)

  return (
    <div className="mx-auto min-h-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-6 w-6 shrink-0 rounded-full"
          style={{ background: 'var(--accent-gradient)' }}
        />
        <span className="font-display accent-text text-sm tracking-wide">SOFII</span>
        <span className="text-sm text-[var(--text-muted)]">· shared conversation</span>
      </div>

      <h1 className="mb-6 text-xl font-bold text-[var(--text)]">{conversation.title}</h1>

      <div className="flex flex-col gap-5">
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div
                className="max-w-[85%] rounded-2xl rounded-tr-sm border border-[var(--border)] px-4 py-2.5 text-sm whitespace-pre-wrap sm:max-w-[70%]"
                style={{ background: 'var(--user-bubble-bg)', color: 'var(--user-bubble-text)' }}
              >
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-3">
              <div
                aria-hidden="true"
                className="mt-0.5 h-7 w-7 shrink-0 rounded-full"
                style={{
                  background: 'var(--accent-gradient)',
                  boxShadow: 'var(--avatar-glow-sm)'
                }}
              />
              <div className="min-w-0 flex-1">
                <AssistantContent content={m.content} />
              </div>
            </div>
          )
        )}
      </div>

      <p className="mt-10 text-center text-xs text-[var(--text-muted)]">
        Shared read-only from Sofii — this link was created by the conversation owner.
      </p>
    </div>
  )
}
