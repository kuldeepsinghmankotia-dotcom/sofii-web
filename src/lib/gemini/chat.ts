import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'

// Overridable via GEMINI_MODEL for the same reason getGroqModel() is: a
// future deprecation only needs an env var change. 'gemini-flash-latest' is
// Google's own always-current alias — verified live against the API on
// 2026-08-05, it currently resolves to gemini-3.6-flash.
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  return key
}

export interface GeminiPart {
  text?: string
  functionCall?: { name: string; args: Record<string, unknown>; id?: string }
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> }
  thoughtSignature?: string
  inlineData?: { mimeType: string; data: string }
}

export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

export interface GeminiToolCall {
  id: string
  name: string
  argumentsJson: string
}

// gemini-3.6-flash is a "thinking" model that cannot fully disable reasoning
// (thinkingBudget: 0 was rejected live with a 400), and its hidden thinking
// tokens are a near-fixed ~280-290 regardless of the budget hint — verified
// live against the API. maxOutputTokens therefore needs headroom above that
// floor, same shape as Groq's SUPPRESS_REASONING problem in
// lib/groq/client.ts, just with a different fixed cost instead of a
// suppressible one.
const THINKING_BUDGET = 128
export const GEMINI_TEXT_MAX_TOKENS = 1024
export const GEMINI_VISION_MAX_TOKENS = 2048

// Our tool schemas (lib/tools/definitions.ts) are plain JSON Schema objects
// (object/string, properties, required) with no OpenAI-specific extensions,
// so they translate directly into Gemini's functionDeclarations parameters
// — confirmed live, the exact same schema shape used for Groq's
// ChatCompletionTool worked unmodified against Gemini's API.
function toGeminiTools(tools: ChatCompletionFunctionTool[]): object[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
      }))
    }
  ]
}

// Gemini only accepts images as inlineData (base64) or a Files API/GCS URI —
// not an arbitrary public HTTPS URL (verified: fileData.fileUri is not
// documented to accept those) — so a Supabase Storage URL has to be fetched
// and re-encoded server-side. Scoped to only the current turn's image, same
// as toContentParam() in api/chat/route.ts and for the same reason: resending
// full image bytes on every subsequent turn would be paying full image
// tokens over and over for old context the assistant's own prior reply
// already captured in text.
export async function fetchImageAsInlineData(
  url: string
): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`)
  const mimeType = response.headers.get('content-type') || 'image/jpeg'
  const buffer = await response.arrayBuffer()
  return { mimeType, data: Buffer.from(buffer).toString('base64') }
}

interface GeminiStreamEvent {
  candidates?: { content?: { parts?: GeminiPart[] } }[]
}

/**
 * Runs one streamed Gemini completion call — the Gemini-side equivalent of
 * groq/client.ts's streamOneRound. Forwards text deltas via onContent as
 * they arrive, and returns every raw part the API sent back (modelParts),
 * since a follow-up round after a tool call must replay the model's exact
 * functionCall parts (including thoughtSignature) or the API rejects the
 * request with "missing thought_signature" — verified live.
 */
export async function streamGeminiRound(
  contents: GeminiContent[],
  systemPrompt: string,
  tools: ChatCompletionFunctionTool[] | undefined,
  maxOutputTokens: number,
  onContent: (delta: string) => void
): Promise<{ toolCalls: GeminiToolCall[]; modelParts: GeminiPart[] }> {
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    ...(tools && tools.length > 0
      ? { tools: toGeminiTools(tools), toolConfig: { functionCallingConfig: { mode: 'AUTO' } } }
      : {}),
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens,
      thinkingConfig: { thinkingBudget: THINKING_BUDGET }
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  )

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Gemini streamGenerateContent failed with status ${response.status}: ${errorText}`)
  }

  const modelParts: GeminiPart[] = []
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // The blank line between SSE events is a separator, not a terminator —
  // the final event of the stream is not guaranteed to be followed by one
  // before the connection closes (verified live: a tool-call-only response
  // arrived as a single event with no trailing blank line). Any event still
  // sitting in `buffer` once the reader reports `done` is flushed the same
  // way below; without this, that last event was silently dropped, which
  // surfaced as completely empty replies after every Gemini tool call.
  const processEvent = (rawEvent: string): void => {
    const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '))
    if (!dataLine) return

    const event = JSON.parse(dataLine.slice(6)) as GeminiStreamEvent
    const parts = event.candidates?.[0]?.content?.parts ?? []
    for (const part of parts) {
      modelParts.push(part)
      if (part.text) onContent(part.text)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE events are separated by a blank line; each event here is a single
    // `data: {...}` line carrying one full GenerateContentResponse chunk.
    let boundary: number
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      processEvent(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
    }
  }

  if (buffer.trim()) processEvent(buffer)

  const toolCalls: GeminiToolCall[] = modelParts
    .filter((part): part is GeminiPart & { functionCall: NonNullable<GeminiPart['functionCall']> } =>
      Boolean(part.functionCall)
    )
    .map((part) => ({
      id: part.functionCall.id ?? crypto.randomUUID(),
      name: part.functionCall.name,
      argumentsJson: JSON.stringify(part.functionCall.args ?? {})
    }))

  return { toolCalls, modelParts }
}
