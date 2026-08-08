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
  threadId: string
}

interface Exchange {
  query: string
  result: QueryResult
}

const INTENT_LABELS: Record<string, string> = {
  answer_from_documents: 'Answered from your documents',
  summarize_document: 'Summary',
  compare_documents: 'Comparison',
  extract_structured_data: 'Extracted data'
}

// A standalone query box, not woven into the main chat interface (that's a
// bigger UX question — see the agentic ingestion plan's Phase 8 notes).
// Selecting documents is optional; answer_from_documents searches across
// all of them by similarity regardless, but summarize/compare/extract need
// an explicit selection.
//
// threadId + exchanges give this workflow the same short-term memory as
// the main chat (last ~10 exchanges, Redis-backed — see
// lib/redis/query-history.ts): follow-up questions like "compare that to
// something cheaper" now have context instead of being answered in
// isolation. The thread is a client-side session only (resets on reload,
// or via "New topic") since this workflow has no durable conversation row.
export default function AskDocuments({
  documents,
  serviceOnline
}: {
  documents: DocumentSummary[]
  serviceOnline: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [exchanges, setExchanges] = useState<Exchange[]>([])
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
    const askedQuery = query
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: askedQuery, documentIds: [...selected], threadId })
      })
      if (!response.ok) throw new Error(await response.text())
      const result = (await response.json()) as QueryResult
      setThreadId(result.threadId)
      setExchanges((prev) => [...prev, { query: askedQuery, result }])
      setQuery('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleNewTopic = (): void => {
    setThreadId(null)
    setExchanges([])
    setError(null)
  }

  return (
    <div className="mt-8 border-t border-[var(--border)] pt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--text)]">Ask about your documents</h2>
        {exchanges.length > 0 && (
          <button onClick={handleNewTopic} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
            New topic
          </button>
        )}
      </div>

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
          placeholder={
            serviceOnline
              ? "e.g. Summarize this document, or what's the total in my invoice?"
              : 'Document tools are temporarily offline — try again in a bit.'
          }
          rows={2}
          disabled={!serviceOnline}
          className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-input)] p-3 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] disabled:opacity-60"
        />
        <button
          onClick={() => void handleAsk()}
          disabled={loading || !query.trim() || !serviceOnline}
          aria-label="Ask"
          className="shrink-0 rounded-lg px-4 py-2 text-[var(--accent-gradient-text)] disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

      {exchanges.length > 0 && (
        <div className="mt-4 space-y-3">
          {exchanges.map((exchange, exchangeIndex) => (
            <div
              key={exchangeIndex}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-4"
            >
              <div className="mb-2 text-sm font-medium text-[var(--text)]">{exchange.query}</div>
              <div className="mb-2 text-xs font-medium text-[var(--accent-a)]">
                {INTENT_LABELS[exchange.result.intent] ?? exchange.result.intent}
              </div>
              <div className="whitespace-pre-wrap text-sm text-[var(--text)]">{exchange.result.answer}</div>
              {exchange.result.citations.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-3">
                  {exchange.result.citations.map((citation, index) => (
                    <div key={citation.chunk_id} className="text-xs text-[var(--text-muted)]">
                      [{index + 1}] {citation.content.slice(0, 120)}
                      {citation.content.length > 120 ? '…' : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
