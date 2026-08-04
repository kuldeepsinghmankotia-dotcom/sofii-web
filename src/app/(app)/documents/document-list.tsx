'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { deleteDocument, type DocumentSummary } from '@/lib/db/documents'

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
        <label className="inline-block cursor-pointer rounded-lg bg-blue-600 px-5 py-3 font-medium disabled:opacity-60">
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
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>

      <div className="space-y-2">
        {documents.length === 0 && <p className="text-neutral-400">No documents uploaded yet.</p>}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between gap-3 rounded-lg bg-neutral-900 p-3"
          >
            <div className="min-w-0">
              <div className="truncate">{doc.filename}</div>
              <div className="text-xs text-neutral-400">
                {new Date(doc.created_at).toLocaleString()}
              </div>
            </div>
            <button
              onClick={() => handleDelete(doc.id)}
              title="Delete document"
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
