'use client'

import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import type { DocumentSummary } from '@/lib/db/documents'

interface Citation {
  document_id: string
  chunk_id: string
  content: string
}

interface QueryResult {
  intent: string
  answer: string
  citations: Citation[]
}

const INTENT_LABELS: Record<string, string> = {
  answer_from_documents: 'Answered from your documents',
  summarize_document: 'Summary',
  compare_documents: 'Comparison',
  extract_structured_data: 'Extracted data'
}

// Deliberately minimal for this phase: a standalone query box, not woven
// into the main chat interface (that's a bigger UX question — see the
// agentic ingestion plan's Phase 8 notes). Selecting documents is optional;
// answer_from_documents searches across all of them by similarity
// regardless, but summarize/compare/extract need an explicit selection.
export default function AskDocuments({ documents }: { documents: DocumentSummary[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (documents.length === 0) return null

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAsk = async (): Promise<void> => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, documentIds: [...selected] })
      })
      if (!response.ok) throw new Error(await response.text())
      setResult((await response.json()) as QueryResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-8 border-t border-[var(--border)] pt-6">
      <h2 className="mb-3 text-sm font-medium text-[var(--text)]">Ask about your documents</h2>

      <div className="mb-3 flex flex-wrap gap-2">
        {documents.map((doc) => (
          <button
            key={doc.id}
            onClick={() => toggleSelected(doc.id)}
            className={`rounded-full border px-3 py-1 text-xs ${
              selected.has(doc.id)
                ? 'border-[var(--accent-a)] text-[var(--accent-a)]'
                : 'border-[var(--border)] text-[var(--text-muted)]'
            }`}
          >
            {doc.filename}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs text-[var(--text-muted)]">
        Select documents above to summarize, compare, or extract data from them — leave none selected
        to search across all of your documents.
      </p>

      <div className="flex gap-2">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Summarize this document, or what's the total in my invoice?"
          rows={2}
          className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-input)] p-3 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
        />
        <button
          onClick={() => void handleAsk()}
          disabled={loading || !query.trim()}
          aria-label="Ask"
          className="shrink-0 rounded-lg px-4 py-2 text-black disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

      {result && (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
          <div className="mb-2 text-xs font-medium text-[var(--accent-a)]">
            {INTENT_LABELS[result.intent] ?? result.intent}
          </div>
          <div className="whitespace-pre-wrap text-sm text-[var(--text)]">{result.answer}</div>
          {result.citations.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-3">
              {result.citations.map((citation, index) => (
                <div key={citation.chunk_id} className="text-xs text-[var(--text-muted)]">
                  [{index + 1}] {citation.content.slice(0, 120)}
                  {citation.content.length > 120 ? '…' : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
