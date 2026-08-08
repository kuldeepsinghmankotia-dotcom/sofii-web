'use client'

import { useState } from 'react'
import { FileText, Sparkles, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { createMemory, deleteMemory, updateMemory, type Memory } from '@/lib/db/memories'
import { Tooltip } from '../tooltip'

const STALE_UNUSED_DAYS = 14
const STALE_SINCE_LAST_USE_DAYS = 30

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)
}

function relativeTime(iso: string): string {
  const days = daysSince(iso)
  if (days < 1 / 24) return 'just now'
  if (days < 1) return `${Math.round(days * 24)}h ago`
  if (days < 30) return `${Math.round(days)}d ago`
  return `${Math.round(days / 30)}mo ago`
}

// "Explainable retrieval" pragmatic subset: rather than a black-box list,
// show why a memory matters (how often it's actually been recalled into a
// chat) and flag ones that have quietly stopped earning their keep — a
// judgment call for the user to act on via the existing delete button, not
// something the app deletes automatically.
function usageLabel(memory: Memory): string {
  if (memory.use_count === 0) return 'Never used yet'
  const times = memory.use_count === 1 ? '1 time' : `${memory.use_count} times`
  return `Used ${times} · last used ${relativeTime(memory.last_used_at!)}`
}

function isStale(memory: Memory): boolean {
  if (memory.use_count === 0) return daysSince(memory.created_at) > STALE_UNUSED_DAYS
  return daysSince(memory.last_used_at!) > STALE_SINCE_LAST_USE_DAYS
}

export default function MemoryList({ initialMemories }: { initialMemories: Memory[] }) {
  const [memories, setMemories] = useState<Memory[]>(initialMemories)
  const [input, setInput] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  const handleAdd = async (): Promise<void> => {
    if (!input.trim()) return

    const supabase = createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) return

    const memory = await createMemory(supabase, { userId: user.id, content: input.trim() })
    setMemories((prev) => [memory, ...prev])
    setInput('')
  }

  const handleDelete = async (id: string): Promise<void> => {
    const supabase = createClient()
    await deleteMemory(supabase, id)
    setMemories((prev) => prev.filter((m) => m.id !== id))
  }

  const startEditing = (memory: Memory): void => {
    setEditingId(memory.id)
    setEditingValue(memory.content)
  }

  const commitEditing = async (): Promise<void> => {
    const id = editingId
    const content = editingValue.trim()
    setEditingId(null)
    if (!id || !content) return

    const supabase = createClient()
    const updated = await updateMemory(supabase, id, content)
    setMemories((prev) => prev.map((m) => (m.id === id ? updated : m)))
  }

  return (
    <div>
      <div className="mb-6 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
          placeholder='Something to remember, e.g. "I prefer TypeScript over JavaScript"'
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <button
          onClick={handleAdd}
          className="rounded-lg px-5 py-3 font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          Add
        </button>
      </div>

      <div className="space-y-2">
        {memories.length === 0 && (
          <p className="text-[var(--text-muted)]">Nothing remembered yet.</p>
        )}
        {memories.map((memory) => (
          <div
            key={memory.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
          >
            <div className="flex items-center justify-between gap-3">
              {editingId === memory.id ? (
                <input
                  autoFocus
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onBlur={commitEditing}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEditing()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 rounded border border-[var(--border-strong)] bg-[var(--surface-input-strong)] px-2 py-1 text-[var(--text)] outline-none"
                />
              ) : (
                <span
                  onDoubleClick={() => startEditing(memory)}
                  title="Double-click to edit"
                  className="flex-1 whitespace-pre-wrap text-[var(--text)]"
                >
                  {memory.content}
                </span>
              )}
              <Tooltip label="Delete memory">
                <button
                  onClick={() => handleDelete(memory.id)}
                  aria-label="Delete memory"
                  className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--danger)]"
                >
                  <X size={14} />
                </button>
              </Tooltip>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
              {memory.source === 'auto' && (
                <span
                  className="model-badge"
                  title="Sofii noticed this in conversation — you didn't ask it to remember this"
                >
                  <Sparkles size={11} className="accent-icon" />
                  Auto-detected
                </span>
              )}
              {memory.source === 'document' && (
                <span
                  className="model-badge"
                  title="Sofii extracted this from a document you uploaded"
                >
                  <FileText size={11} className="accent-icon" />
                  From a document
                </span>
              )}
              <span>{usageLabel(memory)}</span>
              {isStale(memory) && (
                <span
                  className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-400"
                  title="Hasn't been relevant to a recent conversation — consider deleting it if it's no longer useful"
                >
                  not used recently
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
