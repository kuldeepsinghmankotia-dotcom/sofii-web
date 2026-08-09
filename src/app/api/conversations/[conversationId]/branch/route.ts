import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConversation } from '@/lib/db/conversations'

// Forks a conversation at a specific message into a new thread.
//
// The problem this solves: exploring an alternative direction ("what if I
// asked this differently?") previously meant either destroying the
// existing thread by editing/regenerating in place, or starting from
// scratch and losing all the context that led up to that point. Branching
// keeps the original untouched and gives the alternative its own full
// history.
//
// Everything up to AND INCLUDING the chosen message is copied. Branching
// from a user message means "re-answer this question differently";
// branching from an assistant reply means "continue from here down a
// different path" — both are useful, so neither role is special-cased.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
): Promise<Response> {
  const { conversationId } = await params
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  // RLS-scoped: returns null both when the conversation doesn't exist and
  // when it belongs to someone else, so this never reveals which.
  const source = await getConversation(supabase, conversationId)
  if (!source) return new Response('Not found', { status: 404 })

  const body = (await request.json().catch(() => ({}))) as { messageId?: string }
  const messageId = body.messageId
  if (!messageId) return new Response('Missing messageId', { status: 400 })

  // Fetch the branch point first to get its timestamp — "everything up to
  // here" is expressed as created_at <= this, which is stable regardless
  // of how the caller ordered things.
  const { data: branchPoint, error: branchPointError } = await supabase
    .from('messages')
    .select('created_at')
    .eq('id', messageId)
    .eq('conversation_id', conversationId)
    .maybeSingle()

  if (branchPointError) throw branchPointError
  if (!branchPoint) return new Response('Message not found in this conversation', { status: 404 })

  const { data: sourceMessages, error: messagesError } = await supabase
    .from('messages')
    .select('role, content, image_url, embedding, context_sources, created_at')
    .eq('conversation_id', conversationId)
    .lte('created_at', branchPoint.created_at)
    .order('created_at', { ascending: true })

  if (messagesError) throw messagesError

  const { data: branch, error: createError } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      // Marked in the title so a forked thread is identifiable in the
      // sidebar at a glance, rather than looking like a duplicate.
      title: `${source.title} (branch)`
    })
    .select('id')
    .single()

  if (createError) throw createError

  if (sourceMessages && sourceMessages.length > 0) {
    // created_at is copied rather than left to default: the branch is a
    // continuation of a real timeline, and resetting every copied message
    // to "now" would make the recalled-conversation dates shown in reply
    // provenance wrong, and scramble ordering against the original.
    // embedding is copied too, so cross-conversation recall works over the
    // branch immediately without re-embedding (and re-paying) identical text.
    const { error: copyError } = await supabase.from('messages').insert(
      sourceMessages.map((m) => ({
        conversation_id: branch.id,
        user_id: user.id,
        role: m.role,
        content: m.content,
        image_url: m.image_url,
        embedding: m.embedding,
        context_sources: m.context_sources,
        created_at: m.created_at
      }))
    )

    if (copyError) throw copyError
  }

  return Response.json({ conversationId: branch.id, copiedMessages: sourceMessages?.length ?? 0 })
}
