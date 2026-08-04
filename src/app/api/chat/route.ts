import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption
} from 'openai/resources/chat/completions'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_CONVERSATION_TITLE,
  getConversation,
  renameConversation,
  touchConversation
} from '@/lib/db/conversations'
import { insertMessage, listMessages } from '@/lib/db/messages'
import { listMemories } from '@/lib/db/memories'
import { rankMemoriesByRelevance } from '@/lib/memory/ranking'
import { hasAnyDocuments, matchDocumentChunks } from '@/lib/db/documents'
import { embedText } from '@/lib/gemini/embeddings'
import { TOOL_DEFINITIONS } from '@/lib/tools/definitions'
import { executeToolCall } from '@/lib/tools/execute'
import { getGroqClient, getGroqModel, SUPPRESS_REASONING, SYSTEM_PROMPT } from '@/lib/groq/client'
import type { GroqReasoningParams } from '@/lib/groq/client'

type Client = SupabaseClient<Database>
const MEMORY_RECALL_LIMIT = 5
const DOCUMENT_RECALL_LIMIT = 5

interface AccumulatedToolCall {
  id: string
  name: string
  argumentsJson: string
}

/**
 * Runs one streamed completion call, forwarding content deltas via onContent
 * as they arrive and accumulating any tool_calls deltas (Groq has been
 * observed to send a tool call's full id/name/arguments in a single chunk,
 * but this accumulates defensively by index in case that changes).
 */
async function streamOneRound(
  messages: ChatCompletionMessageParam[],
  toolOptions: { tools?: ChatCompletionTool[]; tool_choice?: ChatCompletionToolChoiceOption },
  onContent: (delta: string) => void
): Promise<AccumulatedToolCall[]> {
  const stream = await getGroqClient().chat.completions.create({
    model: getGroqModel(),
    messages,
    temperature: 0.7,
    max_tokens: 1024,
    stream: true,
    ...SUPPRESS_REASONING,
    ...toolOptions
  } as ChatCompletionCreateParamsStreaming & GroqReasoningParams)

  const toolCallsByIndex = new Map<number, AccumulatedToolCall>()

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta

    if (delta?.content) {
      onContent(delta.content)
    }

    if (delta?.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const existing = toolCallsByIndex.get(toolCallDelta.index) ?? {
          id: '',
          name: '',
          argumentsJson: ''
        }
        if (toolCallDelta.id) existing.id = toolCallDelta.id
        if (toolCallDelta.function?.name) existing.name = toolCallDelta.function.name
        if (toolCallDelta.function?.arguments) existing.argumentsJson += toolCallDelta.function.arguments
        toolCallsByIndex.set(toolCallDelta.index, existing)
      }
    }
  }

  return Array.from(toolCallsByIndex.values())
}

async function autoTitleConversation(
  conversationId: string,
  userContent: string,
  assistantContent: string,
  supabase: Client
): Promise<void> {
  try {
    const response = await getGroqClient().chat.completions.create({
      model: getGroqModel(),
      messages: [
        {
          role: 'system',
          content:
            'Generate a short 3-6 word title summarizing this conversation. Reply with only the title itself, no quotes and no trailing punctuation.'
        },
        { role: 'user', content: `User: ${userContent}\nAssistant: ${assistantContent}` }
      ],
      temperature: 0.3,
      // Hidden reasoning tokens count against max_tokens even with
      // include_reasoning: false (verified against the live API), so this
      // needs real headroom above the actual title length.
      max_tokens: 150,
      ...SUPPRESS_REASONING
    } as ChatCompletionCreateParamsNonStreaming & GroqReasoningParams)

    const title = response.choices[0]?.message?.content?.trim()
    if (title) await renameConversation(supabase, conversationId, title)
  } catch (error) {
    console.error('Auto-title error:', error)
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const { conversationId, content } = (await request.json()) as {
    conversationId?: string
    content?: string
  }

  if (!conversationId || !content?.trim()) {
    return new Response('Missing conversationId or content', { status: 400 })
  }

  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // getConversation is RLS-scoped: it returns null both when the
  // conversation doesn't exist and when it belongs to another user, so this
  // 404 never leaks whether a given id belongs to someone else.
  const conversation = await getConversation(supabase, conversationId)
  if (!conversation) {
    return new Response('Not found', { status: 404 })
  }

  const history = await listMessages(supabase, conversationId)
  const shouldAutoTitle = history.length === 0 && conversation.title === DEFAULT_CONVERSATION_TITLE

  await insertMessage(supabase, {
    conversationId,
    userId: user.id,
    role: 'user',
    content
  })

  const relevantMemories = rankMemoriesByRelevance(
    await listMemories(supabase),
    content,
    MEMORY_RECALL_LIMIT
  )

  // Skips the embedding API round-trip entirely when the user has never
  // uploaded a document — the common case, and no point paying that latency
  // (or Gemini quota) for a search that can only come back empty.
  let relevantChunks: { document_id: string; content: string }[] = []
  if (await hasAnyDocuments(supabase)) {
    try {
      const queryEmbedding = await embedText(content)
      relevantChunks = await matchDocumentChunks(supabase, queryEmbedding, DOCUMENT_RECALL_LIMIT)
    } catch (error) {
      // Document recall is a bonus, not a hard dependency — a Gemini outage
      // shouldn't take down chat entirely.
      console.error('Document recall error:', error)
    }
  }

  // The model needs "now" to resolve relative times ("in 10 minutes",
  // "tomorrow at 5pm") into the absolute ISO timestamp create_reminder needs.
  let systemPrompt = `${SYSTEM_PROMPT}\n\nThe current date and time is ${new Date().toString()}.`

  if (relevantMemories.length > 0) {
    systemPrompt += `\n\nThings you remember about the user (only mention if relevant):\n${relevantMemories.map((m) => `- ${m.content}`).join('\n')}`
  }

  if (relevantChunks.length > 0) {
    systemPrompt += `\n\nRelevant excerpts from the user's uploaded documents (cite naturally, don't fabricate beyond what's here):\n${relevantChunks.map((c) => `- ${c.content}`).join('\n\n')}`
  }

  const baseMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam),
    { role: 'user', content }
  ]

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      let fullContent = ''

      const emit = (delta: string): void => {
        fullContent += delta
        controller.enqueue(encoder.encode(delta))
      }

      try {
        const toolCalls = await streamOneRound(
          baseMessages,
          { tools: TOOL_DEFINITIONS, tool_choice: 'auto' },
          emit
        )

        if (toolCalls.length > 0) {
          // Independent tool calls run concurrently rather than one at a time.
          const toolResultMessages: ChatCompletionMessageParam[] = await Promise.all(
            toolCalls.map(async (toolCall) => ({
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: await executeToolCall(
                { name: toolCall.name, argumentsJson: toolCall.argumentsJson },
                supabase,
                user.id
              )
            }))
          )

          const followUpMessages: ChatCompletionMessageParam[] = [
            ...baseMessages,
            {
              role: 'assistant',
              content: fullContent || null,
              tool_calls: toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function',
                function: { name: toolCall.name, arguments: toolCall.argumentsJson }
              }))
            },
            ...toolResultMessages
          ]

          // Bounded to exactly one tool round: no `tools` option here, so
          // the model has nothing left to call and must produce a reply.
          await streamOneRound(followUpMessages, {}, emit)
        }
      } catch (error) {
        console.error('Groq stream error:', error)
        if (!fullContent) controller.enqueue(encoder.encode('Something went wrong.'))
      } finally {
        controller.close()
      }

      if (fullContent) {
        await insertMessage(supabase, {
          conversationId,
          userId: user.id,
          role: 'assistant',
          content: fullContent
        })
        await touchConversation(supabase, conversationId)

        if (shouldAutoTitle) {
          await autoTitleConversation(conversationId, content, fullContent, supabase)
        }
      }
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
