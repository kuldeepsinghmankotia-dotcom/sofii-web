// What actually produced a given assistant reply. Persisted on the
// message (messages.context_sources) so it survives reload and stays
// attached permanently, and rendered under the reply as an expandable
// "why this answer" panel.
//
// Content snippets are stored, not just ids, so the panel stays readable
// even after the underlying memory is edited or the document is deleted —
// it's a record of what the model was actually shown at the time, which
// is the whole point of provenance. A live join would quietly rewrite
// history.

export interface MemorySource {
  id: string
  content: string
}

export interface DocumentSource {
  document_id: string
  filename: string
  snippet: string
}

export interface ConversationSource {
  conversation_id: string
  title: string
  created_at: string
  snippet: string
}

export interface ToolSource {
  name: string
  // Short human-readable summary of what the tool returned, not the raw
  // payload — a full web-search result set would dwarf the reply itself.
  summary: string
}

export interface ContextSources {
  memories?: MemorySource[]
  documents?: DocumentSource[]
  conversations?: ConversationSource[]
  tools?: ToolSource[]
}

const MAX_SNIPPET_CHARS = 240
const MAX_TOOL_SUMMARY_CHARS = 200

export function truncateSnippet(text: string, max = MAX_SNIPPET_CHARS): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}

export function summarizeToolResult(result: string): string {
  return truncateSnippet(result, MAX_TOOL_SUMMARY_CHARS)
}

// True when there's anything worth showing — an answer written purely
// from the model's own knowledge has no provenance to display, and
// rendering an empty "why this answer" affordance would be noise on every
// ordinary reply.
export function hasAnySource(sources: ContextSources | null | undefined): boolean {
  if (!sources) return false
  return Boolean(
    sources.memories?.length ||
      sources.documents?.length ||
      sources.conversations?.length ||
      sources.tools?.length
  )
}
