import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConversation, setConversationShareToken } from '@/lib/db/conversations'

// Generates/revokes the public read-only link for a conversation
// (src/app/share/[token]/page.tsx). Both routes use the normal RLS-scoped
// client — getConversation returning null (conversation doesn't exist, or
// belongs to someone else) is what actually enforces "only the owner can
// share/revoke", not any check written here.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
): Promise<Response> {
  const { conversationId } = await params
  const supabase = await createClient()

  const conversation = await getConversation(supabase, conversationId)
  if (!conversation) return new Response('Not found', { status: 404 })

  const token = crypto.randomUUID()
  await setConversationShareToken(supabase, conversationId, token)

  return Response.json({ url: `${request.nextUrl.origin}/share/${token}` })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
): Promise<Response> {
  const { conversationId } = await params
  const supabase = await createClient()

  const conversation = await getConversation(supabase, conversationId)
  if (!conversation) return new Response('Not found', { status: 404 })

  await setConversationShareToken(supabase, conversationId, null)

  return new Response(null, { status: 204 })
}
