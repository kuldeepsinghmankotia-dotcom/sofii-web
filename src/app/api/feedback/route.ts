import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getChatRatelimit } from '@/lib/redis/ratelimit'

const MAX_MESSAGE_CHARS = 4000
const KINDS = ['suggestion', 'bug', 'help'] as const
type Kind = (typeof KINDS)[number]

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  // Reuses the chat limiter rather than adding a fourth bucket: this
  // endpoint writes a row and spends nothing else, so it only needs
  // abuse protection, not its own budget.
  const rateLimit = await getChatRatelimit().limit(user.id)
  if (!rateLimit.success) {
    return new Response("You're sending feedback too quickly — please try again shortly.", {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000))) }
    })
  }

  const body = (await request.json().catch(() => ({}))) as {
    kind?: string
    message?: string
    pagePath?: string
  }

  const message = body.message?.trim()
  if (!message) return new Response('Missing message', { status: 400 })

  const kind: Kind = KINDS.includes(body.kind as Kind) ? (body.kind as Kind) : 'suggestion'

  const { error } = await supabase.from('feedback').insert({
    user_id: user.id,
    kind,
    message: message.slice(0, MAX_MESSAGE_CHARS),
    page_path: body.pagePath?.slice(0, 300) ?? null,
    // Read server-side rather than trusting a client-supplied value —
    // a bug report's value depends on this being accurate.
    user_agent: request.headers.get('user-agent')?.slice(0, 400) ?? null
  })

  if (error) {
    console.error('Feedback insert error:', error)
    return new Response('Could not save feedback', { status: 500 })
  }

  return new Response(null, { status: 204 })
}
