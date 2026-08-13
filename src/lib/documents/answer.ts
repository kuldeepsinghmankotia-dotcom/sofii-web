import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getGroqClient } from '@/lib/groq/client'
import { embedText } from '@/lib/gemini/embeddings'
import { matchDocumentChunks } from '@/lib/db/documents'

type Client = SupabaseClient<Database>

// Answering a question from the user's own documents.
//
// This used to be proxied to the Python service on the developer's Mac,
// which meant "Ask about your documents" returned "Query service
// unreachable" whenever that machine was asleep — a visibly broken button
// rather than a missing feature. Everything it needed already existed in
// this app: the same embeddings that indexed the documents, the same hybrid
// (vector + full-text) search the chat route uses, and the same model.
//
// Retrieval is identical to chat's, deliberately. A document answered one
// way in chat and another way here would be a subtle, maddening
// inconsistency for anyone who used both.

const MATCH_COUNT = 6
const MAX_HISTORY = 6

/** Enough context to answer well, short enough to stay inside the budget. */
const MAX_CONTEXT_CHARS = 8000

const SYSTEM_PROMPT = `You answer questions using only the user's own documents.

Rules:
- Use only the excerpts provided. Do not add outside knowledge.
- If the excerpts do not contain the answer, say so plainly and say what is
  missing. Never guess or fill gaps.
- Quote figures, dates and names exactly as they appear.
- Be brief and direct.`

export interface DocumentAnswer {
  answer: string
  /** Filenames the answer drew on, for showing provenance. */
  sources: string[]
}

export interface AnswerOptions {
  supabase: Client
  query: string
  /** Restrict to specific documents. Empty means search everything. */
  documentIds?: string[]
  history?: { query: string; answer: string }[]
}

export async function answerFromDocuments({
  supabase,
  query,
  documentIds = [],
  history = []
}: AnswerOptions): Promise<DocumentAnswer> {
  let queryEmbedding: number[]
  try {
    queryEmbedding = await embedText(query)
  } catch (error) {
    console.error('Could not embed document question:', error)
    return {
      answer: "I couldn't search your documents just now. Please try again in a moment.",
      sources: []
    }
  }

  // RLS scopes this to the caller's own chunks; queryText enables the
  // full-text half of hybrid retrieval, which is what finds exact names and
  // figures that embeddings alone rank poorly.
  const matches = await matchDocumentChunks(supabase, queryEmbedding, MATCH_COUNT, query).catch(
    (error) => {
      console.error('Document search failed:', error)
      return []
    }
  )

  // Narrowing happens after retrieval rather than in the query: the RPC has
  // no document filter, and filtering here keeps this a single code path
  // whether or not the user picked specific documents.
  const relevant = documentIds.length > 0
    ? matches.filter((m) => documentIds.includes(m.document_id))
    : matches

  if (relevant.length === 0) {
    return {
      answer:
        documentIds.length > 0
          ? "I couldn't find anything about that in the documents you selected."
          : "I couldn't find anything about that in your documents. If you haven't uploaded the relevant one yet, add it and ask again.",
      sources: []
    }
  }

  // Chunk matches carry only a document_id, so filenames are resolved in one
  // extra read. Worth it: an answer that names the document it came from is
  // checkable, and an answer that does not is just an assertion.
  const { data: docs } = await supabase
    .from('documents')
    .select('id, filename')
    .in('id', [...new Set(relevant.map((m) => m.document_id))])

  const filenameById = new Map((docs ?? []).map((d) => [d.id, d.filename]))

  let used = 0
  const excerpts: string[] = []
  const sources = new Set<string>()

  for (const match of relevant) {
    const filename = filenameById.get(match.document_id) ?? 'a document'
    const block = `From "${filename}":\n${match.content}`
    if (used + block.length > MAX_CONTEXT_CHARS) break
    excerpts.push(block)
    sources.add(filename)
    used += block.length
  }

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    // Prior exchanges let follow-ups like "and the total?" resolve against
    // what was just asked.
    ...history.slice(-MAX_HISTORY).flatMap((h) => [
      { role: 'user' as const, content: h.query },
      { role: 'assistant' as const, content: h.answer }
    ]),
    {
      role: 'user' as const,
      content: `Excerpts from my documents:\n\n${excerpts.join('\n\n---\n\n')}\n\nQuestion: ${query}`
    }
  ]

  try {
    const completion = await getGroqClient().chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages,
      max_tokens: 900
    })

    const answer = completion.choices[0]?.message?.content?.trim()
    if (!answer) throw new Error('empty completion')

    return { answer, sources: [...sources] }
  } catch (error) {
    console.error('Document answer generation failed:', error)
    return {
      answer: 'I found relevant passages but could not summarise them just now. Please try again.',
      sources: [...sources]
    }
  }
}
