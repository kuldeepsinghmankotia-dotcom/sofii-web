'use client'

import { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { deleteDocument, type DocumentSummary } from '@/lib/db/documents'
import { Tooltip } from '../tooltip'

export default function DocumentList({ initialDocuments }: { initialDocuments: DocumentSummary[] }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>(initialDocuments)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/documents/upload', { method: 'POST', body: formData })
      if (!response.ok) throw new Error(await response.text())

      const { document } = (await response.json()) as { document: DocumentSummary }
      setDocuments((prev) => [document, ...prev])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    const supabase = createClient()
    await deleteDocument(supabase, id)
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }

  return (
    <div>
      <div className="mb-6">
        <label
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-5 py-3 font-medium text-black disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          <Upload size={15} />
          {uploading ? 'Uploading…' : 'Upload PDF'}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
        </label>
        {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
      </div>

      <div className="space-y-2">
        {documents.length === 0 && (
          <p className="text-[var(--text-muted)]">No documents uploaded yet.</p>
        )}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
          >
            <div className="min-w-0">
              <div className="truncate text-[var(--text)]">{doc.filename}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {new Date(doc.created_at).toLocaleString()}
              </div>
            </div>
            <Tooltip label="Delete document">
              <button
                onClick={() => handleDelete(doc.id)}
                aria-label="Delete document"
                className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--danger)]"
              >
                <X size={14} />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  )
}
