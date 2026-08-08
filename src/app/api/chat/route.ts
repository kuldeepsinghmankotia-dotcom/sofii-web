import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionContentPart,
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
import { insertMessage, listMessages, type ChatMessage } from '@/lib/db/messages'
import { createMemory, listMemories, recordMemoryUsage } from '@/lib/db/memories'
import { rankMemoriesByRelevance } from '@/lib/memory/ranking'
import { extractMemoryCandidate } from '@/lib/memory/extract'
import { hasAnyDocuments, matchDocumentChunks } from '@/lib/db/documents'
import { embedText } from '@/lib/gemini/embeddings'
import {
  fetchImageAsInlineData,
  GEMINI_TEXT_MAX_TOKENS,
  GEMINI_VISION_MAX_TOKENS,
  streamGeminiRound,
  type GeminiContent
} from '@/lib/gemini/chat'
import { TOOL_DEFINITIONS } from '@/lib/tools/definitions'
import { executeToolCall } from '@/lib/tools/execute'
import {
  getGroqClient,
  getGroqModel,
  SUPPRESS_REASONING,
  SUPPRESS_VISION_REASONING,
  VISION_MODEL
} from '@/lib/groq/client'
import type { GroqReasoningParams, GroqVisionReasoningParams } from '@/lib/groq/client'
import { getActiveSystemPrompt } from '@/lib/db/system-prompt'

type Client = SupabaseClient<Database>
type ModelChoice = 'groq' | 'gemini'
const MEMORY_RECALL_LIMIT = 5
const DOCUMENT_RECALL_LIMIT = 5

interface AccumulatedToolCall {
  id: string
  name: string
  argumentsJson: string
}

function toContentParam(
  message: { content: string; image_url: string | null },
  includeImage: boolean
): string | ChatCompletionContentPart[] {
  if (!message.image_url || !includeImage) return message.content
  return [
    { type: 'text', text: message.content },
    { type: 'image_url', image_url: { url: message.image_url } }
  ]
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
  model: {
    name: string
    maxTokens: number
    reasoning: GroqReasoningParams | GroqVisionReasoningParams
  },
  onContent: (delta: string) => void
): Promise<AccumulatedToolCall[]> {
  const stream = await getGroqClient().chat.completions.create({
    model: model.name,
    messages,
    temperature: 0.7,
    max_tokens: model.maxTokens,
    stream: true,
    ...model.reasoning,
    ...toolOptions
  } as ChatCompletionCreateParamsStreaming & GroqReasoningParams & GroqVisionReasoningParams)

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
        if (toolCallDelta.function?.arguments)
          existing.argumentsJson += toolCallDelta.function.arguments
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

// Fire-and-forget companion to autoTitleConversation above — same
// "best-effort, log and swallow" shape since neither should ever fail or
// delay the chat response itself. Notices durable facts in ordinary
// conversation without the user explicitly asking Sofii to remember them
// (that explicit path is the separate create_memory tool call in
// src/lib/tools/execute.ts).
async function autoExtractMemory(
  userId: string,
  userContent: string,
  assistantContent: string,
  supabase: Client
): Promise<void> {
  try {
    const existing = await listMemories(supabase)
    const candidate = await extractMemoryCandidate(
      existing.map((m) => m.content),
      userContent,
      assistantContent
    )
    if (candidate) await createMemory(supabase, { userId, content: candidate, source: 'auto' })
  } catch (error) {
    console.error('Auto-memory extraction error:', error)
  }
}

// Converts stored chat history into Gemini's `contents` shape. Only the
// current turn's image (isCurrentTurn) is attached as inlineData — same
// scoping rule as toContentParam()'s includeImage, and for the same reason:
// resending a full image's bytes on every later turn burns real vision
// tokens for context the assistant's own prior reply already captured in
// text.
async function toGeminiContents(
  messages: { role: string; content: string; image_url: string | null }[]
): Promise<GeminiContent[]> {
  const contents: GeminiContent[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const parts: GeminiContent['parts'] = [{ text: m.content }]
    if (m.image_url && i === messages.length - 1) {
      try {
        parts.push({ inlineData: await fetchImageAsInlineData(m.image_url) })
      } catch (error) {
        console.error('Gemini image fetch error:', error)
      }
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts })
  }
  return contents
}

export async function POST(request: NextRequest): Promise<Response> {
  const {
    conversationId,
    content,
    imageUrl,
    regenerate,
    model: modelChoice
  } = (await request.json()) as {
    conversationId?: string
    content?: string
    imageUrl?: string
    regenerate?: boolean
    model?: ModelChoice
  }

  if (!conversationId || (!regenerate && !content?.trim())) {
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
  const shouldAutoTitle =
    !regenerate && history.length === 0 && conversation.title === DEFAULT_CONVERSATION_TITLE

  // Regenerate reuses the last user message already in history instead of
  // inserting a new one — the client already deleted the old assistant
  // reply it's replacing (see chat-window.tsx's regenerate()), so the last
  // history row really is the user turn to answer again.
  let effectiveContent: string
  let effectiveImageUrl: string | undefined

  if (regenerate) {
    const lastUserMessage = [...history].reverse().find((m) => m.role === 'user')
    if (!lastUserMessage) {
      return new Response('Nothing to regenerate', { status: 400 })
    }
    effectiveContent = lastUserMessage.content
    effectiveImageUrl = lastUserMessage.image_url ?? undefined
  } else {
    effectiveContent = content!
    effectiveImageUrl = imageUrl
    await insertMessage(supabase, {
      conversationId,
      userId: user.id,
      role: 'user',
      content: effectiveContent,
      imageUrl: effectiveImageUrl
    })
  }

  const relevantMemories = rankMemoriesByRelevance(
    await listMemories(supabase),
    effectiveContent,
    MEMORY_RECALL_LIMIT
  )

  if (relevantMemories.length > 0) {
    // Usage tracking is a bonus for the Memories page's "explainable
    // retrieval" display, not something a chat reply should ever fail over.
    recordMemoryUsage(
      supabase,
      relevantMemories.map((m) => m.id)
    ).catch((error) => console.error('Memory usage tracking error:', error))
  }

  // Skips the embedding API round-trip entirely when the user has never
  // uploaded a document — the common case, and no point paying that latency
  // (or Gemini quota) for a search that can only come back empty.
  let relevantChunks: { document_id: string; content: string }[] = []
  if (await hasAnyDocuments(supabase)) {
    try {
      const queryEmbedding = await embedText(effectiveContent)
      relevantChunks = await matchDocumentChunks(supabase, queryEmbedding, DOCUMENT_RECALL_LIMIT)
    } catch (error) {
      // Document recall is a bonus, not a hard dependency — a Gemini outage
      // shouldn't take down chat entirely.
      console.error('Document recall error:', error)
    }
  }

  // The model needs "now" to resolve relative times ("in 10 minutes",
  // "tomorrow at 5pm") into the absolute ISO timestamp create_reminder needs.
  const activeSystemPrompt = await getActiveSystemPrompt(supabase)
  let systemPrompt = `${activeSystemPrompt}\n\nThe current date and time is ${new Date().toString()}.`

  if (relevantMemories.length > 0) {
    systemPrompt += `\n\nThings you remember about the user (only mention if relevant):\n${relevantMemories.map((m) => `- ${m.content}`).join('\n')}`
  }

  if (relevantChunks.length > 0) {
    systemPrompt += `\n\nRelevant excerpts from the user's uploaded documents (cite naturally, don't fabricate beyond what's here):\n${relevantChunks.map((c) => `- ${c.content}`).join('\n\n')}`
  }

  // openai/gpt-oss-120b (the default text model) rejects vision content
  // outright, so a turn with a new image switches to a vision-capable
  // model. Deliberately scoped to ONLY the current message's image, not any
  // image earlier in history — a real production bug, found live: a
  // full-resolution photo (unlike the small test images used to build this)
  // costs vastly more tokens, and re-sending it as vision content on every
  // subsequent turn (the original approach, meant to let the model "still
  // see" an image referenced a few messages back) blew through Groq's 8000
  // TPM limit for the vision model and broke every later message in that
  // conversation, image-related or not. Past image messages replay as
  // plain text below — the assistant's own prior reply already captured
  // what was in the image, so that context isn't actually lost, just not
  // re-paid for in image tokens every turn.
  // On regenerate, `history` already ends with the user message being
  // answered again (nothing new to append); otherwise the just-inserted
  // user message is appended as a plain in-memory object rather than
  // re-fetched from the DB.
  const currentMessage: ChatMessage = {
    id: '',
    role: 'user',
    content: effectiveContent,
    created_at: '',
    image_url: effectiveImageUrl ?? null
  }
  const conversationMessages = regenerate ? history : [...history, currentMessage]
  const usesVision = !!effectiveImageUrl
  // Gemini is natively multimodal (no separate vision model needed like
  // Groq's VISION_MODEL fallback), so only Groq's branch needs usesVision to
  // pick a different model — Gemini's branch just needs it for max tokens.
  const selectedModel: ModelChoice = modelChoice === 'gemini' ? 'gemini' : 'groq'

  // 1536 is real headroom now that SUPPRESS_VISION_REASONING includes
  // reasoning_effort: 'none' — reasoning is disabled outright rather than
  // just hidden, so this budget only has to cover the actual visible
  // description (774 completion tokens observed for a detailed real photo).
  // Bumping max_tokens alone was tried first and failed: with reasoning
  // merely hidden (not disabled), a 3072-token budget was still exhausted
  // entirely by reasoning on a real photo, twice, at different sizes.
  const groqModel = usesVision
    ? { name: VISION_MODEL, maxTokens: 1536, reasoning: SUPPRESS_VISION_REASONING }
    : { name: getGroqModel(), maxTokens: 1024, reasoning: SUPPRESS_REASONING }

  const baseMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationMessages.map(
      (m, i) =>
        ({
          role: m.role,
          content: toContentParam(m, i === conversationMessages.length - 1)
        }) as ChatCompletionMessageParam
    )
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
        if (selectedModel === 'gemini') {
          const geminiContents = await toGeminiContents(conversationMessages)
          const maxTokens = usesVision ? GEMINI_VISION_MAX_TOKENS : GEMINI_TEXT_MAX_TOKENS

          const { toolCalls, modelParts } = await streamGeminiRound(
            geminiContents,
            systemPrompt,
            TOOL_DEFINITIONS,
            maxTokens,
            emit
          )

          if (toolCalls.length > 0) {
            const responseParts = await Promise.all(
              toolCalls.map(async (toolCall) => ({
                functionResponse: {
                  name: toolCall.name,
                  id: toolCall.id,
                  response: {
                    result: await executeToolCall(
                      { name: toolCall.name, argumentsJson: toolCall.argumentsJson },
                      supabase,
                      user.id
                    )
                  }
                }
              }))
            )

            const followUpContents: GeminiContent[] = [
              ...geminiContents,
              { role: 'model', parts: modelParts },
              { role: 'user', parts: responseParts }
            ]

            // Bounded to exactly one tool round: no tools passed here, so
            // the model has nothing left to call and must produce a reply
            // — same shape as the Groq follow-up round below.
            await streamGeminiRound(followUpContents, systemPrompt, undefined, maxTokens, emit)
          }
        } else if (usesVision) {
          // Groq's vision model (VISION_MODEL) doesn't reliably support
          // real structured tool-calling alongside image content —
          // verified live: given an image + a question needing a web
          // lookup (e.g. "what's the price of this watch"), it wrote a
          // literal `<tool_call>...</tool_call>`-shaped string into the
          // visible reply instead of actually invoking search_web via the
          // API's real function-calling mechanism. Split into two rounds
          // instead: the vision model first produces a grounded,
          // question-aware description of the image (no tools offered,
          // nothing streamed to the user yet — this round is perception
          // only), then the normal text model — which reliably handles
          // tool-calling everywhere else in this app — answers the user's
          // actual question using that description as context, with full
          // tool access including search_web.
          let imageDescription = ''
          await streamOneRound(baseMessages, {}, groqModel, (delta) => {
            imageDescription += delta
          })

          const textModel = { name: getGroqModel(), maxTokens: 1024, reasoning: SUPPRESS_REASONING }
          const descriptionSystemPrompt = `${systemPrompt}\n\nThe user's message included an image. Here is a factual description of what it shows:\n${imageDescription}`
          const textOnlyMessages: ChatCompletionMessageParam[] = [
            { role: 'system', content: descriptionSystemPrompt },
            ...conversationMessages.map(
              (m) => ({ role: m.role, content: toContentParam(m, false) }) as ChatCompletionMessageParam
            )
          ]

          const toolCalls = await streamOneRound(
            textOnlyMessages,
            { tools: TOOL_DEFINITIONS, tool_choice: 'auto' },
            textModel,
            emit
          )

          if (toolCalls.length > 0) {
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
              ...textOnlyMessages,
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

            await streamOneRound(followUpMessages, {}, textModel, emit)
          }
        } else {
          const toolCalls = await streamOneRound(
            baseMessages,
            { tools: TOOL_DEFINITIONS, tool_choice: 'auto' },
            groqModel,
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
            await streamOneRound(followUpMessages, {}, groqModel, emit)
          }
        }
      } catch (error) {
        console.error(`${selectedModel} stream error:`, error)
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
          await autoTitleConversation(conversationId, effectiveContent, fullContent, supabase)
        }

        // Not awaited: a memory-worth-saving check shouldn't add latency to
        // a response that already finished streaming.
        void autoExtractMemory(user.id, effectiveContent, fullContent, supabase)
      }
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Model': selectedModel }
  })
}
