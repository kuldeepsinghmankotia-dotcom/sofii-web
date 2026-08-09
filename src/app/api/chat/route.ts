import { NextRequest, after } from 'next/server'
import { getChatRatelimit } from '@/lib/redis/ratelimit'
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
import { listDocuments, matchDocumentChunks } from '@/lib/db/documents'
import { embedMessages, recallRelatedMessages } from '@/lib/db/message-embeddings'
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
import {
  appendCachedMessages,
  getCachedHistory,
  invalidateCachedHistory,
  setCachedHistory
} from '@/lib/redis/conversation-history'

type Client = SupabaseClient<Database>
type ModelChoice = 'groq' | 'gemini'
const MEMORY_RECALL_LIMIT = 5
const DOCUMENT_RECALL_LIMIT = 5
// Deliberately smaller than the other two: past-conversation excerpts are
// whole messages rather than tight chunks, so each one costs far more
// context budget, and stale cross-talk is more distracting to the model
// than a missed recall is harmful.
const CONVERSATION_RECALL_LIMIT = 3

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

  const rateLimit = await getChatRatelimit().limit(user.id)
  if (!rateLimit.success) {
    return new Response(
      "You're sending messages too quickly — please slow down and try again shortly.",
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000)))
        }
      }
    )
  }

  // getConversation is RLS-scoped: it returns null both when the
  // conversation doesn't exist and when it belongs to another user, so this
  // 404 never leaks whether a given id belongs to someone else.
  const conversation = await getConversation(supabase, conversationId)
  if (!conversation) {
    return new Response('Not found', { status: 404 })
  }

  // Redis-cached read (last ~10 exchanges) in front of Supabase — cuts a
  // Postgres round-trip on the common case of continuing an already-active
  // conversation. Supabase stays authoritative: a cache miss falls back to
  // it and repopulates the cache, and every write below still goes to
  // Supabase first regardless of cache state.
  const cachedHistory = await getCachedHistory(conversationId)
  const history = cachedHistory ?? (await listMessages(supabase, conversationId))
  if (!cachedHistory) void setCachedHistory(conversationId, history)
  const shouldAutoTitle =
    !regenerate && history.length === 0 && conversation.title === DEFAULT_CONVERSATION_TITLE

  // Regenerate reuses the last user message already in history instead of
  // inserting a new one — the client already deleted the old assistant
  // reply it's replacing (see chat-window.tsx's regenerate()), so the last
  // history row really is the user turn to answer again.
  let effectiveContent: string
  let effectiveImageUrl: string | undefined
  // Captured so this turn can be embedded for cross-conversation recall
  // after the reply is sent. Null on regenerate: that path reuses a user
  // message that already exists (and was already embedded on its original
  // turn), so re-embedding it would spend quota to write the same vector.
  let insertedUserMessageId: string | null = null

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
    const inserted = await insertMessage(supabase, {
      conversationId,
      userId: user.id,
      role: 'user',
      content: effectiveContent,
      imageUrl: effectiveImageUrl
    })
    insertedUserMessageId = inserted.id
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

  // One cheap indexed query doubles as the "has any documents" check (skips
  // the embedding API round-trip entirely for the common case of a user
  // with none) and supplies the id/filename list the summarize_document/
  // compare_documents/extract_structured_data tools need to reference a
  // specific document by id.
  const userDocuments = await listDocuments(supabase)

  // One embedding of the user's message, reused for both document search
  // and cross-conversation recall below — embedding the same text twice
  // per turn would double the latency and API quota for no benefit.
  let queryEmbedding: number[] | null = null
  try {
    queryEmbedding = await embedText(effectiveContent)
  } catch (error) {
    // Both recall paths degrade to "no extra context" rather than failing
    // the chat — a Gemini outage shouldn't take down chat entirely.
    console.error('Query embedding error:', error)
  }

  let relevantChunks: { document_id: string; content: string }[] = []
  if (userDocuments.length > 0 && queryEmbedding) {
    try {
      relevantChunks = await matchDocumentChunks(
        supabase,
        queryEmbedding,
        DOCUMENT_RECALL_LIMIT,
        effectiveContent
      )
    } catch (error) {
      console.error('Document recall error:', error)
    }
  }

  // Cross-conversation recall: pulls in what was said about this topic in
  // the user's OTHER conversations. Without this, every past conversation
  // is a sealed box — "what did we decide about that last week?" had no
  // way to find an answer already sitting in the database.
  // recallRelatedMessages never throws (returns [] on failure), so this
  // needs no try/catch of its own.
  const recalledMessages = queryEmbedding
    ? await recallRelatedMessages(supabase, queryEmbedding, conversationId, CONVERSATION_RECALL_LIMIT)
    : []

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

  if (recalledMessages.length > 0) {
    // Dated and attributed so the model can say "you mentioned last
    // Tuesday..." naturally, and so it can tell its own past words apart
    // from the user's. Explicitly framed as possibly-stale: an old
    // conversation is evidence of what was said then, not necessarily
    // what's true now, and the model shouldn't assert it as current fact.
    const recallBlock = recalledMessages
      .map((m) => {
        const when = new Date(m.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
        const speaker = m.role === 'user' ? 'User said' : 'You said'
        return `- [${when}, in "${m.conversation_title}"] ${speaker}: ${m.content.slice(0, 600)}`
      })
      .join('\n')

    systemPrompt += `\n\nRelevant excerpts from the user's OTHER past conversations with you. Use these to stay consistent and to answer questions about what was discussed before. They may be outdated — treat them as a record of what was said at that time, not as guaranteed-current fact, and reference when it was said if it matters:\n${recallBlock}`
  }

  if (userDocuments.length > 0) {
    systemPrompt += `\n\nAvailable documents (use these ids with summarize_document/compare_documents/extract_structured_data — match by filename, and ask the user to clarify if it's ambiguous which one they mean):\n${userDocuments.map((d) => `- ${d.id}: ${d.filename}`).join('\n')}`
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
        // Set when Gemini's own attempt fails specifically due to its
        // shared free-tier quota (20 generateContent requests/day across
        // this whole app — chat, OCR, and memory extraction all draw from
        // it, and it's been exhausted repeatedly during this project's own
        // testing) — a genuinely common failure mode, not a rare edge case,
        // so it gets a real fallback rather than a dead-end error.
        let useGroqFallback = false

        if (selectedModel === 'gemini') {
          try {
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
                        user.id,
                        { conversationId }
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
          } catch (geminiError) {
            const message = geminiError instanceof Error ? geminiError.message : String(geminiError)
            const isQuotaError = /RESOURCE_EXHAUSTED|429|quota/i.test(message)
            // Only fall back before anything has streamed yet — a failure
            // mid-reply after real content already reached the client
            // should surface as an error, not silently restart with a
            // different model partway through.
            if (isQuotaError && !fullContent) {
              console.error('Gemini quota exceeded, falling back to Groq for this turn:', message)
              emit("_Gemini's free daily limit was reached — answering with Groq instead._\n\n")
              useGroqFallback = true
            } else {
              throw geminiError
            }
          }
        }

        if (selectedModel !== 'gemini' || useGroqFallback) {
          if (usesVision) {
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
            // Dedicated extraction-focused prompt for this internal round —
            // deliberately separate from the global Sofii personality prompt,
            // since this reply is never shown to the user. Explicitly asks
            // for verbatim text (brand/model markings on the object itself,
            // not just surrounding UI chrome) and concrete specs, so round 2
            // has enough to search on rather than a vague visual summary.
            const IMAGE_ANALYSIS_SYSTEM_PROMPT =
              "Carefully analyze the attached image and describe it factually and thoroughly. Extract and transcribe ALL visible text exactly as shown — including text printed or engraved on an object itself (e.g. brand name, model/collection name, model number, specs on a product's face or packaging), not just surrounding UI text. If the image shows a product, explicitly identify: brand, model/collection name, model number, category, and any visible specifications (materials, size, capacity, movement type, water resistance, etc.). Be precise and complete — this description is used to research the product further, so don't omit details."
            const imageAnalysisMessages: ChatCompletionMessageParam[] = [
              { role: 'system', content: IMAGE_ANALYSIS_SYSTEM_PROMPT },
              ...conversationMessages.map(
                (m, i) =>
                  ({
                    role: m.role,
                    content: toContentParam(m, i === conversationMessages.length - 1)
                  }) as ChatCompletionMessageParam
              )
            ]

            let imageDescription = ''
            await streamOneRound(imageAnalysisMessages, {}, groqModel, (delta) => {
              imageDescription += delta
            })

            const textModel = {
              name: getGroqModel(),
              maxTokens: 1024,
              reasoning: SUPPRESS_REASONING
            }
            const descriptionSystemPrompt = `${systemPrompt}\n\nThe user's message included an image. Here is a factual description of what it shows, including any text extracted from it:\n${imageDescription}\n\nIf the user is asking about a product shown in the image (price, specs, or purchase info), don't just look up that exact product: also proactively search for and mention 2-3 comparable competing products in a similar price range with similar specifications, so the user can compare options, not just find the same item at different sellers.`
            const textOnlyMessages: ChatCompletionMessageParam[] = [
              { role: 'system', content: descriptionSystemPrompt },
              ...conversationMessages.map(
                (m) =>
                  ({
                    role: m.role,
                    content: toContentParam(m, false)
                  }) as ChatCompletionMessageParam
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
                    user.id,
                    { conversationId }
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
                    user.id,
                    { conversationId }
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
        }
      } catch (error) {
        console.error(`${selectedModel} stream error:`, error)
        if (!fullContent) controller.enqueue(encoder.encode('Something went wrong.'))
      }

      // Deliberately NOT in a `finally` above, and controller.close() is
      // deliberately delayed until after this persist attempt (not called
      // the moment generation finishes) — a real production bug, found
      // live: the assistant's full reply streamed to the browser
      // successfully (so it looked fine to the user, and even survived
      // into a Markdown export), but insertMessage() below threw with no
      // error handling at all, so the DB write silently never happened.
      // Every later turn in that conversation then fetched history missing
      // that entire exchange — the model wasn't "forgetting" context, the
      // context had genuinely never been saved. One retry covers the
      // common transient case; if it still fails, the client is told
      // explicitly rather than silently losing the turn.
      if (fullContent) {
        let insertedAssistantMessageId: string | null = null
        const persistReply = async (): Promise<void> => {
          const inserted = await insertMessage(supabase, {
            conversationId,
            userId: user.id,
            role: 'assistant',
            content: fullContent
          })
          insertedAssistantMessageId = inserted.id
          await touchConversation(supabase, conversationId)
        }

        try {
          try {
            await persistReply()
          } catch (firstError) {
            console.error('Failed to persist assistant reply, retrying once:', firstError)
            await persistReply()
          }

          if (shouldAutoTitle) {
            await autoTitleConversation(conversationId, effectiveContent, fullContent, supabase)
          }

          // Keep the Redis cache warm for the next turn. Regenerate
          // replaces an existing assistant message rather than appending a
          // new exchange, which the cache can't cheaply splice in-place —
          // simplest correct move there is to drop it and let the next
          // read repopulate from Supabase (still authoritative either way).
          //
          // Scheduled via after(), not bare `void`: this stream's Response
          // is already in flight, and a plain un-awaited promise here isn't
          // guaranteed to finish before Vercel tears down the invocation —
          // confirmed live (the equivalent pattern in /api/query silently
          // dropped its Redis write). after() is the supported way to run
          // work post-response without making the client wait for it.
          if (regenerate) {
            after(() => invalidateCachedHistory(conversationId))
          } else {
            after(() =>
              appendCachedMessages(conversationId, [
                { role: 'user', content: effectiveContent, image_url: effectiveImageUrl ?? null },
                { role: 'assistant', content: fullContent, image_url: null }
              ])
            )
          }

          // Scheduled via after() for the same reason — a memory-worth-
          // saving check shouldn't add latency to the stream, but it still
          // needs to actually complete.
          after(() => autoExtractMemory(user.id, effectiveContent, fullContent, supabase))

          // Embeds this turn so it's findable from future conversations
          // (see lib/db/message-embeddings.ts). after() rather than
          // awaited: this costs an embedding round-trip and the reply has
          // already streamed, so it must not add latency — but it does
          // need to actually finish, which a bare `void` wouldn't
          // guarantee on Vercel.
          const turnMessages = [
            insertedUserMessageId ? { id: insertedUserMessageId, content: effectiveContent } : null,
            insertedAssistantMessageId
              ? { id: insertedAssistantMessageId, content: fullContent }
              : null
          ].filter((m): m is { id: string; content: string } => m !== null)

          if (turnMessages.length > 0) {
            after(() => embedMessages(supabase, turnMessages))
          }
        } catch (persistError) {
          console.error('Failed to persist assistant reply after retry:', persistError)
          controller.enqueue(
            encoder.encode(
              "\n\n⚠️ This reply couldn't be saved, so it won't be remembered in later messages — please try asking again if that matters here."
            )
          )
        }
      }

      controller.close()
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Model': selectedModel }
  })
}
