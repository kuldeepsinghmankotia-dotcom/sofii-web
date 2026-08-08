'use client'

import { useState } from 'react'
import { toast } from 'sonner'

export default function SystemPromptForm({ initialContent }: { initialContent: string }) {
  const [content, setContent] = useState(initialContent)
  // Tracks the last-saved value separately from the initial server-rendered
  // prop — without this, "dirty" kept comparing against the original page
  // load's content forever, so the "Unsaved changes" label (and the
  // disabled Save button) never cleared after a successful save.
  const [savedContent, setSavedContent] = useState(initialContent)
  const [saving, setSaving] = useState(false)

  const dirty = content.trim() !== savedContent.trim()

  const handleSave = async (): Promise<void> => {
    const trimmed = content.trim()
    if (!trimmed) return

    setSaving(true)
    try {
      const response = await fetch('/api/admin/system-prompt', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed })
      })
      if (!response.ok) throw new Error(await response.text())
      setSavedContent(trimmed)
      toast.success('System prompt updated')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={14}
        className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 font-mono text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        {dirty && <span className="text-xs text-[var(--text-muted)]">Unsaved changes</span>}
        <button
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="rounded-lg px-5 py-2.5 text-sm font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
