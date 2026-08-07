import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOwnRole } from '@/lib/db/profiles'
import { getActiveSystemPrompt } from '@/lib/db/system-prompt'

// GET is only really needed as a fresh-data escape hatch (the page itself
// server-renders the current value) — PATCH is the route that matters.
// Both re-check the admin role server-side rather than trusting the page's
// own redirect: a redirect is a UX nicety, not a security boundary.
export async function GET(): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const role = await getOwnRole(supabase, user.id)
  if (role !== 'admin') return new Response('Forbidden', { status: 403 })

  const content = await getActiveSystemPrompt(supabase)
  return Response.json({ content })
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const role = await getOwnRole(supabase, user.id)
  if (role !== 'admin') return new Response('Forbidden', { status: 403 })

  const { content } = (await request.json()) as { content?: string }
  const trimmed = content?.trim()
  if (!trimmed) return new Response('content is required', { status: 400 })

  const { error } = await supabase
    .from('system_prompts')
    .update({ content: trimmed, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq('key', 'default')

  if (error) return new Response(error.message, { status: 500 })
  return new Response(null, { status: 204 })
}
