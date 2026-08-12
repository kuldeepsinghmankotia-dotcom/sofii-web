'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { deleteDocument, type DocumentSummary } from '@/lib/db/documents'
import { Tooltip } from '../tooltip'

type IngestingJobStatus = 'pending' | 'processing' | 'failed'

interface IngestingJob {
  id: string
  filename: string
  status: IngestingJobStatus
  errorMessage?: string
}

type IngestedDocument = DocumentSummary & { flaggedForReview?: boolean }

// Anything that isn't a PDF and isn't rejected client-side goes through
// /api/ingest (the Python pipeline) — server-side validation there is the
// real gate, this set only decides which upload path the browser takes.
// Read in-app by Sarvam Vision, so they need nothing else running.
const DIRECT_OCR_EXTENSIONS = new Set(['png', 'jpg', 'jpeg'])

const INGEST_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'html',
  'htm',
  'csv',
  'docx',
  'pptx',
  'xlsx',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp'
])
const POLL_INTERVAL_MS = 2000

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

export default function DocumentList({
  initialDocuments,
  serviceOnline
}: {
  initialDocuments: DocumentSummary[]
  serviceOnline: boolean
}) {
  const [documents, setDocuments] = useState<IngestedDocument[]>(initialDocuments)
  const [jobs, setJobs] = useState<IngestingJob[]>([])
  const [uploading, setUploading] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [uploadingUrl, setUploadingUrl] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const jobsRef = useRef<IngestingJob[]>([])

  useEffect(() => {
    jobsRef.current = jobs
  }, [jobs])

  // Single persistent interval (not one per job, not re-created per poll)
  // that reads the live job list via a ref, matching the established
  // polling pattern in reminder-poller.tsx.
  useEffect(() => {
    const poll = async (): Promise<void> => {
      const active = jobsRef.current.filter((job) => job.status !== 'failed')

      for (const job of active) {
        try {
          const response = await fetch(`/api/ingest/status/${job.id}`)
          if (!response.ok) continue

          const data = (await response.json()) as {
            status: 'pending' | 'processing' | 'done' | 'failed'
            errorMessage: string | null
            document: DocumentSummary | null
            flaggedForReview: boolean
          }

          if (data.status === 'done' && data.document) {
            const doneDocument: IngestedDocument = {
              ...data.document,
              flaggedForReview: data.flaggedForReview
            }
            setDocuments((prev) => [doneDocument, ...prev])
            setJobs((prev) => prev.filter((j) => j.id !== job.id))
          } else if (data.status === 'failed') {
            setJobs((prev) =>
              prev.map((j) =>
                j.id === job.id
                  ? { ...j, status: 'failed', errorMessage: data.errorMessage ?? 'Ingestion failed' }
                  : j
              )
            )
          } else if (data.status !== job.status) {
            setJobs((prev) =>
              prev.map((j) => (j.id === job.id ? { ...j, status: data.status as IngestingJobStatus } : j))
            )
          }
        } catch {
          // Best-effort: a failed poll just waits for the next tick.
        }
      }
    }

    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  const uploadPdf = async (file: File): Promise<void> => {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch('/api/documents/upload', { method: 'POST', body: formData })
    if (!response.ok) throw new Error(await response.text())

    const { document } = (await response.json()) as { document: DocumentSummary }
    setDocuments((prev) => [document, ...prev])
  }

  const uploadViaIngest = async (file: File): Promise<void> => {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch('/api/ingest', { method: 'POST', body: formData })
    if (!response.ok) throw new Error(await response.text())

    const { jobId } = (await response.json()) as { jobId: string }
    setJobs((prev) => [...prev, { id: jobId, filename: file.name, status: 'pending' }])
  }

  const handleUrlSubmit = async (): Promise<void> => {
    const trimmed = urlValue.trim()
    if (!trimmed) return

    setUploadingUrl(true)
    setError(null)

    try {
      if (!serviceOnline) {
        throw new Error('Document tools are temporarily offline — try again in a bit.')
      }
      const response = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed })
      })
      if (!response.ok) throw new Error(await response.text())

      const { jobId } = (await response.json()) as { jobId: string }
      setJobs((prev) => [...prev, { id: jobId, filename: trimmed, status: 'pending' }])
      setUrlValue('')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setUploadingUrl(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    try {
      const extension = extensionOf(file.name)
      // Photos and PDFs both go straight to the app's own upload route,
      // which reads them with Sarvam Vision. Images used to be routed to the
      // Mac-hosted service, which meant a photo of a bill or a handwritten
      // note — the most common thing an Indian user has to hand — only
      // worked while that machine was awake.
      if (file.type === 'application/pdf' || extension === 'pdf' || DIRECT_OCR_EXTENSIONS.has(extension)) {
        await uploadPdf(file)
      } else if (INGEST_EXTENSIONS.has(extension)) {
        if (!serviceOnline) {
          throw new Error(
            'Document tools are temporarily offline, so this file type can\'t be processed right now — only PDF uploads work at the moment.'
          )
        }
        await uploadViaIngest(file)
      } else {
        throw new Error(
          'Unsupported file type. Use PDF, .docx, .pptx, .xlsx, .txt, .md, .html, .csv, or an image.'
        )
      }
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

  const dismissJob = (jobId: string): void => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId))
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-5 py-3 font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          <Upload size={15} />
          {uploading ? 'Uploading…' : 'Upload document'}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.txt,.md,.markdown,.html,.htm,.csv,.docx,.pptx,.xlsx,image/*"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
        </label>

        <div className="flex items-center gap-2">
          <input
            type="url"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleUrlSubmit()
            }}
            placeholder="or paste a web page URL to ingest"
            disabled={uploadingUrl}
            className="w-64 rounded-lg border border-[var(--border)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] disabled:opacity-60"
          />
          <button
            onClick={() => void handleUrlSubmit()}
            disabled={uploadingUrl || !urlValue.trim()}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-60"
          >
            {uploadingUrl ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
      {error && <p className="-mt-4 mb-6 text-sm text-[var(--danger)]">{error}</p>}

      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              {job.status !== 'failed' && (
                <Loader2 size={14} className="shrink-0 animate-spin text-[var(--text-muted)]" />
              )}
              <div className="min-w-0">
                <div className="truncate text-[var(--text)]">{job.filename}</div>
                <div className="text-xs">
                  {job.status === 'failed' ? (
                    <span className="text-[var(--danger)]">{job.errorMessage}</span>
                  ) : (
                    <span className="text-[var(--text-muted)]">
                      {job.status === 'processing' ? 'Processing…' : 'Queued…'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {job.status === 'failed' && (
              <Tooltip label="Dismiss">
                <button
                  onClick={() => dismissJob(job.id)}
                  aria-label="Dismiss"
                  className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--danger)]"
                >
                  <X size={14} />
                </button>
              </Tooltip>
            )}
          </div>
        ))}

        {documents.length === 0 && jobs.length === 0 && (
          <p className="text-[var(--text-muted)]">No documents uploaded yet.</p>
        )}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate text-[var(--text)]">{doc.filename}</div>
                {doc.flaggedForReview && (
                  <Tooltip label="Gemini and Ollama's OCR readings of this image disagreed — check the extracted text">
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                      <AlertTriangle size={11} />
                      Flagged for review
                    </span>
                  </Tooltip>
                )}
              </div>
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
