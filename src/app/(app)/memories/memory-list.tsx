'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createMemory, deleteMemory, updateMemory, type Memory } from '@/lib/db/memories'

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
          <div
            key={memory.id}
            className="flex items-center justify-between gap-3 rounded-lg bg-neutral-900 p-3"
          >
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
        ))}
      </div>
    </div>
  )
}
