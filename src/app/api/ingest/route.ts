import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { createIngestionJob, markIngestionJobFailed } from '@/lib/db/ingestion-jobs'
import { resolveIngestServiceUrl } from '@/lib/db/service-endpoints'
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
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
  // Resolved per-request rather than read from the env at build time: the
  // quick tunnel's hostname changes on every cloudflared restart, and this
  // lets the refresh script publish the new one without a redeploy.
  const serviceUrl = await resolveIngestServiceUrl()
  const serviceSecret = process.env.INGEST_SERVICE_SECRET

  if (!serviceUrl || !serviceSecret) {
    // Same reasoning as the unreachable case below: a missing env var is
    // our problem to fix, not something to narrate to the person who just
    // wanted to upload a file.
    console.error('Ingestion attempted with INGEST_SERVICE_URL/SECRET unset')
    return new Response(
      'Uploads of this file type are temporarily unavailable — nothing was lost, please try again in a few minutes. (PDFs are unaffected.)',
      { status: 503 }
    )
  }

  const storagePath = `${user.id}/${randomUUID()}-${params.filename}`

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_UPLOADS_BUCKET)
    .upload(storagePath, params.bytes, { contentType: params.mimeType })

  if (uploadError) {
    return new Response(`Failed to upload file: ${uploadError.message}`, { status: 500 })
  }

  // The file is already in Storage by this point, but nothing yet points at
  // it: the job row is what records where it went. If this insert fails the
  // upload is unreachable and unattributable — no row, no cleanup, orphaned
  // forever. (Observed for real: a missing column made this throw, and the
  // file was still sitting in the bucket afterwards.) Every failure between
  // the upload and a committed job row has to undo the upload itself.
  let job
  try {
    job = await createIngestionJob(supabase, { userId: user.id, filename: params.filename, storagePath })
  } catch (error) {
    await supabase.storage.from(DOCUMENT_UPLOADS_BUCKET).remove([storagePath])
    console.error('Failed to create ingestion job, removed orphaned upload:', storagePath, error)
    return new Response(
      'Uploads of this file type are temporarily unavailable — nothing was lost, please try again in a few minutes. (PDFs are unaffected.)',
      { status: 503 }
    )
  }

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
      }),
      // This handoff only enqueues work — the service replies as soon as it
      // has accepted the job, so anything slower than this is a sick
      // upstream, not a big file. Without a timeout a machine that is
      // asleep-but-still-tunnelled accepts the TCP connection and then
      // never answers, leaving the user watching a spinner until the
      // platform's 300s function timeout kills it.
      signal: AbortSignal.timeout(15_000)
    })

    if (!upstream.ok) {
      throw new Error(`Ingestion service returned ${upstream.status}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // The file was already uploaded above but the job never made it to the
    // Python service, so nothing will ever process (or clean up) it —
    // delete it now rather than leaving it orphaned in Storage forever.
    // The internal detail goes to the job row (visible to us in the DB),
    // never to the user.
    await markIngestionJobFailed(supabase, job.id, `Ingestion service unreachable: ${message}`, storagePath)
    console.error('Ingestion service unreachable:', message)
    // Deliberately not "Ingestion service unreachable": that is our
    // vocabulary, not the user's, and it reads as "this product is
    // broken". This path means one optional backend is temporarily down —
    // PDFs and everything else still work — so say that, and say what to
    // do about it.
    return new Response(
      'Uploads of this file type are temporarily unavailable — nothing was lost, please try again in a few minutes. (PDFs are unaffected.)',
      { status: 503 }
    )
  }

  return Response.json({ jobId: job.id }, { status: 202 })
}

// Filename derived from the URL for display purposes only — sanitized to
// a safe, bounded set of characters since it flows into a Storage path.
function filenameFromUrl(url: URL, extension: string): string {
  const raw = `${url.hostname}${url.pathname}`.replace(/\/+$/, '') || url.hostname
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)
  return `${safe}.${extension}`
}

// image/* is allowed here too — beyond generic image URLs, this is how
// chat's "save this image as a document" action (chat-window.tsx) feeds an
// already-analyzed chat image into the real OCR ingestion pipeline: chat
// images live in the public chat-images bucket, so their URL is just
// another public HTTPS URL from this endpoint's point of view, no
// different from a user pasting any other image link.
const INGESTIBLE_URL_CONTENT_TYPES: Record<string, string> = {
  'text/html': 'html',
  'text/plain': 'txt',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
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

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim()
  const matchedType = Object.keys(INGESTIBLE_URL_CONTENT_TYPES).find((t) => contentType === t)

  if (!matchedType) {
    return new Response(
      'Only web pages and images can be ingested by URL — upload other file types directly.',
      { status: 400 }
    )
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_FILE_BYTES) {
    return new Response('That file is too large (max 4MB)', { status: 400 })
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return new Response('That file is too large (max 4MB)', { status: 400 })
  }
  if (buffer.byteLength === 0) {
    return new Response('That URL had no content', { status: 400 })
  }

  const finalUrl = new URL(response.url || rawUrl)
  return startIngestionJob(supabase, user, {
    filename: filenameFromUrl(finalUrl, INGESTIBLE_URL_CONTENT_TYPES[matchedType]),
    mimeType: matchedType,
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
      'Only .txt, .md, .html, .csv, .docx, .pptx, .xlsx, and image (.jpg/.png/.gif/.webp) files are supported here',
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
