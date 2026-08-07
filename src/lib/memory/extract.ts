import { getGroqClient, getGroqModel, SUPPRESS_REASONING } from '@/lib/groq/client'
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions'
import type { GroqReasoningParams } from '@/lib/groq/client'

// Caps how much existing-memory context goes into the extraction prompt —
// this is a dedupe hint, not the full recall list api/chat/route.ts already
// does for answering; a long-lived user could otherwise accumulate hundreds
// of memories and blow the prompt budget just checking for duplicates.
const EXISTING_MEMORIES_LIMIT = 20

const EXTRACT_SYSTEM_PROMPT = `You silently watch a conversation between a user and an AI assistant, looking for durable facts about the user worth remembering long-term (preferences, ongoing projects, relationships, recurring context) — the kind of thing worth recalling in a future, unrelated conversation.

Rules:
- Reply with exactly one short standalone sentence stating the new fact, OR the single word NONE.
- Only extract something genuinely durable and new. Skip small talk, one-off questions, or anything already covered by the user's existing remembered facts listed below.
- Never invent details not actually stated by the user.
- NONE is the right answer far more often than not — most exchanges contain nothing worth remembering.`

/**
 * Fire-and-forget companion to the explicit create_memory tool
 * (src/lib/tools/execute.ts) — that one only saves a fact when the user
 * asks Sofii to remember something; this notices durable facts in ordinary
 * conversation without being asked. Returns null for "nothing worth
 * remembering," which is the expected common case.
 */
export async function extractMemoryCandidate(
  existingMemories: string[],
  userContent: string,
  assistantContent: string
): Promise<string | null> {
  const recentMemories = existingMemories.slice(0, EXISTING_MEMORIES_LIMIT)
  const memoriesBlock =
    recentMemories.length > 0
      ? `Facts already remembered about this user:\n${recentMemories.map((m) => `- ${m}`).join('\n')}`
      : 'No facts are remembered about this user yet.'

  const response = await getGroqClient().chat.completions.create({
    model: getGroqModel(),
    messages: [
      { role: 'system', content: `${EXTRACT_SYSTEM_PROMPT}\n\n${memoriesBlock}` },
      {
        role: 'user',
        content: `User: ${userContent}\nAssistant: ${assistantContent}`
      }
    ],
    temperature: 0.2,
    // Hidden reasoning tokens count against max_tokens even with
    // include_reasoning: false (see autoTitleConversation's identical note
    // in api/chat/route.ts) — this only needs to fit one short sentence,
    // but reasoning eats the same budget regardless of output length.
    max_tokens: 150,
    ...SUPPRESS_REASONING
  } as ChatCompletionCreateParamsNonStreaming & GroqReasoningParams)

  const reply = response.choices[0]?.message?.content?.trim()
  if (!reply || reply.toUpperCase() === 'NONE') return null
  return reply
}
