'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createMemory, deleteMemory, updateMemory, type Memory } from '@/lib/db/memories'

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
          className="flex-1 rounded-lg bg-neutral-800 p-3 outline-none"
        />
        <button
          onClick={handleAdd}
          className="rounded-lg bg-blue-600 px-5 py-3 font-medium disabled:opacity-60"
        >
          Add
        </button>
      </div>

      <div className="space-y-2">
        {memories.length === 0 && <p className="text-neutral-400">Nothing remembered yet.</p>}
        {memories.map((memory) => (
          <div key={memory.id} className="rounded-lg bg-neutral-900 p-3">
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
                  className="flex-1 rounded border border-blue-600 bg-black px-2 py-1 outline-none"
                />
              ) : (
                <span
                  onDoubleClick={() => startEditing(memory)}
                  title="Double-click to edit"
                  className="flex-1 whitespace-pre-wrap"
                >
                  {memory.content}
                </span>
              )}
              <button
                onClick={() => handleDelete(memory.id)}
                title="Delete memory"
                className="shrink-0 text-neutral-400 hover:text-neutral-200"
              >
                ✕
              </button>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
              <span>{usageLabel(memory)}</span>
              {isStale(memory) && (
                <span
                  className="rounded bg-amber-900/40 px-1.5 py-0.5 text-amber-400"
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
