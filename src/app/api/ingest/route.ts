import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createIngestionJob, markIngestionJobFailed } from '@/lib/db/ingestion-jobs'

// Same platform cap as /api/documents/upload — see that route's comment.
const MAX_FILE_BYTES = 4 * 1024 * 1024

const DOCUMENT_UPLOADS_BUCKET = 'document-uploads'

// Extension -> canonical mime type, decided here rather than trusting the
// browser-supplied File.type (inconsistent across OS/browser for .csv in
// particular) — the Python service's format router relies on this being
// accurate.
const SUPPORTED_EXTENSIONS: Record<string, string> = {
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp'
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return new Response('Missing file', { status: 400 })
  }

  const extension = extensionOf(file.name)
  const mimeType = SUPPORTED_EXTENSIONS[extension]

  if (!mimeType) {
    return new Response(
      'Only .txt, .html, .csv, .docx, and image (.jpg/.png/.gif/.webp) files are supported here',
      { status: 400 }
    )
  }

  if (file.size > MAX_FILE_BYTES) {
    return new Response('File too large (max 4MB)', { status: 400 })
  }

  const serviceUrl = process.env.INGEST_SERVICE_URL
  const serviceSecret = process.env.INGEST_SERVICE_SECRET

  if (!serviceUrl || !serviceSecret) {
    return new Response('Ingestion service is not configured', { status: 503 })
  }

  const storagePath = `${user.id}/${randomUUID()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_UPLOADS_BUCKET)
    .upload(storagePath, file, { contentType: mimeType })

  if (uploadError) {
    return new Response(`Failed to upload file: ${uploadError.message}`, { status: 500 })
  }

  const job = await createIngestionJob(supabase, { userId: user.id, filename: file.name })

  try {
    const upstream = await fetch(`${serviceUrl}/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: job.id,
        user_id: user.id,
        storage_path: storagePath,
        filename: file.name,
        mime_type: mimeType
      })
    })

    if (!upstream.ok) {
      throw new Error(`Ingestion service returned ${upstream.status}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markIngestionJobFailed(supabase, job.id, `Ingestion service unreachable: ${message}`)
    return new Response('Ingestion service unreachable', { status: 502 })
  }

  return Response.json({ jobId: job.id }, { status: 202 })
}
