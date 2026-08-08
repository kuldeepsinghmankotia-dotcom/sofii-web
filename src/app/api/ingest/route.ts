import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { createIngestionJob, markIngestionJobFailed } from '@/lib/db/ingestion-jobs'
import { getIngestRatelimit } from '@/lib/redis/ratelimit'
import { fetchPublicUrl } from '@/lib/security/url-fetch-guard'

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

type Client = SupabaseClient<Database>

// Shared by both the file-upload and URL-ingestion paths: stages bytes in
// Storage, creates the ingestion_jobs row, and hands the job to the Python
// service — everything downstream of "we have bytes + a mime type" is
// identical regardless of where those bytes came from.
async function startIngestionJob(
  supabase: Client,
  user: User,
  params: { filename: string; mimeType: string; bytes: Blob | Buffer }
): Promise<Response> {
  const serviceUrl = process.env.INGEST_SERVICE_URL
  const serviceSecret = process.env.INGEST_SERVICE_SECRET

  if (!serviceUrl || !serviceSecret) {
    return new Response('Ingestion service is not configured', { status: 503 })
  }

  const storagePath = `${user.id}/${randomUUID()}-${params.filename}`

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_UPLOADS_BUCKET)
    .upload(storagePath, params.bytes, { contentType: params.mimeType })

  if (uploadError) {
    return new Response(`Failed to upload file: ${uploadError.message}`, { status: 500 })
  }

  const job = await createIngestionJob(supabase, { userId: user.id, filename: params.filename, storagePath })

  try {
    const upstream = await fetch(`${serviceUrl}/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: job.id,
        user_id: user.id,
        storage_path: storagePath,
        filename: params.filename,
        mime_type: params.mimeType
      })
    })

    if (!upstream.ok) {
      throw new Error(`Ingestion service returned ${upstream.status}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // The file was already uploaded above but the job never made it to the
    // Python service, so nothing will ever process (or clean up) it —
    // delete it now rather than leaving it orphaned in Storage forever.
    await markIngestionJobFailed(supabase, job.id, `Ingestion service unreachable: ${message}`, storagePath)
    return new Response('Ingestion service unreachable', { status: 502 })
  }

  return Response.json({ jobId: job.id }, { status: 202 })
}

// Filename derived from the URL for display purposes only — sanitized to
// a safe, bounded set of characters since it flows into a Storage path.
function filenameFromUrl(url: URL): string {
  const raw = `${url.hostname}${url.pathname}`.replace(/\/+$/, '') || url.hostname
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)
  return `${safe}.html`
}

async function handleUrlIngestion(request: NextRequest, supabase: Client, user: User): Promise<Response> {
  const body = (await request.json()) as { url?: string }
  const rawUrl = body.url?.trim()

  if (!rawUrl) {
    return new Response('Missing url', { status: 400 })
  }

  let response: Response
  try {
    response = await fetchPublicUrl(rawUrl, { signal: AbortSignal.timeout(10_000) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(`Could not fetch that URL: ${message}`, { status: 400 })
  }

  if (!response.ok) {
    return new Response(`That URL returned an error (status ${response.status})`, { status: 400 })
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    return new Response(
      'Only web pages (text/html) can be ingested by URL — upload other file types directly.',
      { status: 400 }
    )
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_FILE_BYTES) {
    return new Response('That page is too large (max 4MB)', { status: 400 })
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return new Response('That page is too large (max 4MB)', { status: 400 })
  }
  if (buffer.byteLength === 0) {
    return new Response('That page had no content', { status: 400 })
  }

  const finalUrl = new URL(response.url || rawUrl)
  return startIngestionJob(supabase, user, {
    filename: filenameFromUrl(finalUrl),
    mimeType: 'text/html',
    bytes: buffer
  })
}

async function handleFileIngestion(request: NextRequest, supabase: Client, user: User): Promise<Response> {
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

  return startIngestionJob(supabase, user, { filename: file.name, mimeType, bytes: file })
}

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const rateLimit = await getIngestRatelimit().limit(user.id)
  if (!rateLimit.success) {
    return new Response("You've uploaded too many documents recently — please try again later.", {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000))) }
    })
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return handleUrlIngestion(request, supabase, user)
  }
  return handleFileIngestion(request, supabase, user)
}
