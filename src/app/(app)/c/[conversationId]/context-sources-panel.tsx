'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Brain, ChevronDown, FileText, MessagesSquare, Sparkles, Wrench } from 'lucide-react'
import type { ContextSources } from '@/lib/db/context-sources'
import { hasAnySource } from '@/lib/db/context-sources'

// Human-readable names for the tools the model can call — the raw
// snake_case identifier is an implementation detail, not something to
// show a user.
const TOOL_LABELS: Record<string, string> = {
  create_reminder: 'Created a reminder',
  create_memory: 'Saved a memory',
  list_reminders: 'Checked your reminders',
  get_weather: 'Checked the weather',
  search_web: 'Searched the web',
  list_calendar_events: 'Checked your calendar',
  create_calendar_event: 'Added a calendar event',
  recall_past_conversations: 'Searched past conversations',
  summarize_document: 'Summarized a document',
  compare_documents: 'Compared documents',
  extract_structured_data: 'Extracted data from a document'
}

function SourceGroup({
  icon: Icon,
  title,
  children
}: {
  icon: typeof Brain
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-[var(--text-muted)] uppercase">
        <Icon size={11} className="accent-icon" aria-hidden="true" />
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function SourceItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1.5 text-xs leading-relaxed text-[var(--text-muted)]">
      {children}
    </div>
  )
}

/**
 * "Why this answer" — the four independent context sources Sofii can draw
 * on before replying (memories, documents, other conversations, live tool
 * calls), shown per message.
 *
 * Collapsed by default: on a normal reply this is reassurance the user
 * doesn't need, and expanding it by default would bury the actual answer
 * under its own footnotes.
 */
export function ContextSourcesPanel({ sources }: { sources: ContextSources | null | undefined }) {
  const [open, setOpen] = useState(false)

  if (!hasAnySource(sources)) return null
  const s = sources!

  const count =
    (s.memories?.length ?? 0) +
    (s.documents?.length ?? 0) +
    (s.conversations?.length ?? 0) +
    (s.tools?.length ?? 0)

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--text-muted)] transition hover:bg-[var(--surface-button-hover)] hover:text-[var(--text)]"
      >
        <Sparkles size={12} className="accent-icon" aria-hidden="true" />
        {open ? 'Hide sources' : `Why this answer (${count})`}
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
          {s.memories && s.memories.length > 0 && (
            <SourceGroup icon={Brain} title="Things I remember about you">
              {s.memories.map((m) => (
                <SourceItem key={m.id}>{m.content}</SourceItem>
              ))}
            </SourceGroup>
          )}

          {s.documents && s.documents.length > 0 && (
            <SourceGroup icon={FileText} title="From your documents">
              {s.documents.map((d, i) => (
                <SourceItem key={`${d.document_id}-${i}`}>
                  <span className="font-medium text-[var(--text)]">{d.filename}</span>
                  <span className="mx-1.5">·</span>
                  {d.snippet}
                </SourceItem>
              ))}
            </SourceGroup>
          )}

          {s.conversations && s.conversations.length > 0 && (
            <SourceGroup icon={MessagesSquare} title="From earlier conversations">
              {s.conversations.map((c, i) => (
                <SourceItem key={`${c.conversation_id}-${i}`}>
                  <Link
                    href={`/c/${c.conversation_id}`}
                    className="font-medium text-[var(--accent-a)] hover:underline"
                  >
                    {c.title}
                  </Link>
                  <span className="mx-1.5">·</span>
                  <span className="whitespace-nowrap">
                    {new Date(c.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </span>
                  <div className="mt-0.5">{c.snippet}</div>
                </SourceItem>
              ))}
            </SourceGroup>
          )}

          {s.tools && s.tools.length > 0 && (
            <SourceGroup icon={Wrench} title="Actions I took">
              {s.tools.map((t, i) => (
                <SourceItem key={`${t.name}-${i}`}>
                  <span className="font-medium text-[var(--text)]">
                    {TOOL_LABELS[t.name] ?? t.name}
                  </span>
                  <div className="mt-0.5">{t.summary}</div>
                </SourceItem>
              ))}
            </SourceGroup>
          )}
        </div>
      )}
    </div>
  )
}
