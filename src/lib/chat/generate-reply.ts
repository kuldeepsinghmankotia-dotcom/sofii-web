import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { Database } from '@/types/database'
import { getGroqClient } from '@/lib/groq/client'
import { getActiveSystemPrompt } from '@/lib/db/system-prompt'
import { insertMessage, listMessages } from '@/lib/db/messages'
import { touchConversation } from '@/lib/db/conversations'
import { recordMemoryUsage, type Memory } from '@/lib/db/memories'
import { rankMemoriesByRelevance } from '@/lib/memory/ranking'
import { embedText } from '@/lib/gemini/embeddings'
import { TOOL_DEFINITIONS } from '@/lib/tools/definitions'
import { executeToolCall } from '@/lib/tools/execute'

type Client = SupabaseClient<Database>

// A reply generated without a browser attached.
//
// The main chat route streams over SSE into a live page and reads the
// caller's cookie session. Neither exists for a message that arrived over
// WhatsApp: there is no socket to stream into and no session to read, only
// a user id resolved from a phone number. This produces the whole reply in
// one call, using the same models, tools, memories and documents.
//
// Deliberately a separate function rather than a refactor of the streaming
// route. That route is long and carries a lot of hard-won behaviour
// (Gemini fallbacks, image handling, quota messaging); rewriting it to
// serve both shapes would put all of it at risk to gain a channel that
// needs a fraction of it.

const MAX_TOOL_ROUNDS = 4
const HISTORY_LIMIT = 20
const MEMORY_LIMIT = 8
const DOCUMENT_CHUNK_LIMIT = 4

// WhatsApp is a chat window on a phone, not a document viewer. Long replies
// are split across bubbles and become unreadable, so the model is asked for
// brevity here in a way the web app does not need.
const CHANNEL_GUIDANCE = `
You are replying over WhatsApp. Keep answers short and conversational —
a few sentences unless the user explicitly asks for detail. Do not use
markdown headings or tables; WhatsApp renders neither. Plain sentences,
with *bold* only where it genuinely helps.`

export interface GenerateReplyOptions {
  supabase: Client
  userId: string
  conversationId: string
  userText: string
  model?: string
}

/**
 * Produce a reply and persist both sides of the exchange.
 *
 * Returns the assistant's text, or null if the model produced nothing —
 * callers decide what to say in that case, since a channel like WhatsApp
 * cannot simply show an empty bubble.
 */
export async function generateReply({
  supabase,
  userId,
  conversationId,
  userText,
  model = 'openai/gpt-oss-120b'
}: GenerateReplyOptions): Promise<string | null> {
  await insertMessage(supabase, {
    conversationId,
    userId,
    role: 'user',
    content: userText
  })

  const [history, systemPrompt] = await Promise.all([
    listMessages(supabase, conversationId),
    getActiveSystemPrompt(supabase)
  ])

  // One embedding, reused for both document search and memory ranking —
  // the same economy the streaming route makes, and it matters more here
  // because Gemini's embedding quota is the tighter of the two budgets.
  let queryEmbedding: number[] | null = null
  try {
    queryEmbedding = await embedText(userText)
  } catch (error) {
    // Retrieval degrades to no document context rather than failing the
    // reply outright.
    console.error('Embedding failed for WhatsApp message:', error)
  }

  const contextBlocks: string[] = []

  // Every read below filters by user_id explicitly.
  //
  // This runs on a service-role client, because a webhook has no session to
  // scope one to. Service role bypasses RLS entirely, so the usual helpers
  // (listMemories, matchDocumentChunks) are unsafe here: they carry no
  // user_id filter of their own and rely on RLS to supply it. Calling them
  // with this client would pull *every* user's memories and documents into
  // one person's reply.
  const { data: memoryRows } = await supabase
    .from('memories')
    .select('id, content, created_at, updated_at, last_used_at, use_count, source, user_id, embedding')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (memoryRows && memoryRows.length > 0) {
    // Cast: the generated row type widens `source` to string, while Memory
    // narrows it to the enum. The database check constraint already
    // guarantees the narrower set.
    const ranked = rankMemoriesByRelevance(memoryRows as Memory[], userText, MEMORY_LIMIT)
    if (ranked.length > 0) {
      contextBlocks.push(
        `What you remember about this person:\n${ranked.map((m) => `- ${m.content}`).join('\n')}`
      )
      // Fire-and-forget: usage counts inform future ranking but must never
      // delay or fail a reply.
      void recordMemoryUsage(
        supabase,
        ranked.map((m) => m.id)
      ).catch(() => {})
    }
  }

  if (queryEmbedding) {
    // The _for_service variant takes the user id as an argument precisely
    // because the caller holds service role and RLS cannot narrow it.
    const { data: chunks } = await supabase.rpc('match_document_chunks_for_service', {
      query_embedding: JSON.stringify(queryEmbedding),
      target_user_id: userId,
      match_count: DOCUMENT_CHUNK_LIMIT,
      query_text: userText
    })

    if (chunks && chunks.length > 0) {
      contextBlocks.push(
        `Relevant excerpts from their documents:\n${chunks
          .map((c: { content: string }) => c.content)
          .join('\n---\n')}`
      )
    }
  }

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: [
        systemPrompt,
        CHANNEL_GUIDANCE,
        `Today's date is ${new Date().toISOString().slice(0, 10)}.`,
        ...contextBlocks
      ].join('\n\n')
    },
    ...history.slice(-HISTORY_LIMIT).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))
  ]

  const groq = getGroqClient()
  let reply = ''

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // The final round drops the tools entirely: offering them again after
    // the budget is spent invites another tool call the loop cannot serve,
    // which Groq rejects outright rather than answering.
    const isFinalRound = round === MAX_TOOL_ROUNDS

    const completion = await groq.chat.completions.create({
      model,
      messages,
      ...(isFinalRound ? {} : { tools: TOOL_DEFINITIONS, tool_choice: 'auto' as const })
    })

    const choice = completion.choices[0]?.message
    if (!choice) break

    if (choice.content) reply = choice.content

    const toolCalls = choice.tool_calls ?? []
    if (toolCalls.length === 0) break

    messages.push({
      role: 'assistant',
      content: choice.content ?? null,
      tool_calls: toolCalls
    })

    const results = await Promise.all(
      toolCalls.map(async (call) => {
        // Groq's union includes non-function call types; only function
        // calls are executable here.
        if (call.type !== 'function') {
          return { role: 'tool' as const, tool_call_id: call.id, content: 'Unsupported tool type.' }
        }
        const content = await executeToolCall(
          { name: call.function.name, argumentsJson: call.function.arguments },
          supabase,
          userId,
          { conversationId }
        )
        return { role: 'tool' as const, tool_call_id: call.id, content }
      })
    )

    messages.push(...results)
  }

  const trimmed = reply.trim()
  if (!trimmed) return null

  await insertMessage(supabase, {
    conversationId,
    userId,
    role: 'assistant',
    content: trimmed
  })

  await touchConversation(supabase, conversationId).catch(() => {})

  return trimmed
}
