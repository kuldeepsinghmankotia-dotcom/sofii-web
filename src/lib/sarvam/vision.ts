import { getSarvamApiKey } from './client'

// Sarvam Vision — OCR for documents in Indian languages, including
// handwriting.
//
// This exists as a TypeScript path rather than another node in the
// Mac-hosted Python service on purpose. Document ingestion currently depends
// on that machine being awake and its quick tunnel being alive, which is a
// poor foundation for the format that matters most to Indian users: a photo
// of a form, a bill, or a handwritten note. Running OCR here means those
// work whether or not the Mac is on.
//
// It also covers ground the existing ensemble does not. Gemini and a local
// Ollama model are both weak on Indic scripts and weaker on handwriting;
// Sarvam Vision handles 23 languages and is built for exactly this.

const BASE_URL = 'https://api.sarvam.ai/doc-ai/v1'

/** Documented ceilings. Enforced here so a violation is a clear message. */
export const MAX_PAGES = 10
export const MAX_FILE_BYTES = 200 * 1024 * 1024

/**
 * How long to wait for a job before giving up.
 *
 * OCR is genuinely slow — pages are processed individually — and the caller
 * is a background ingestion job rather than someone watching a spinner, so
 * patience costs little. The ceiling exists so a stuck job cannot occupy a
 * function slot indefinitely.
 */
const POLL_TIMEOUT_MS = 240_000
const POLL_INTERVAL_MS = 3000

export type VisionJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | string

interface JobCreated {
  job_id: string
  status: VisionJobStatus
}

interface JobStatus {
  job_id: string
  status: VisionJobStatus
  usage?: {
    pages_total?: number
    pages_processed?: number
    pages_succeeded?: number
    pages_failed?: number
  }
  error?: { message?: string }
}

export interface DigitiseResult {
  /** Markdown of the whole document, pages joined in order. */
  markdown: string
  pages: number
  pagesFailed: number
}

function headers(apiKey: string): Record<string, string> {
  return { 'api-subscription-key': apiKey }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * OCR a document into markdown.
 *
 * Returns null on any failure rather than throwing: this runs inside an
 * ingestion job where the caller already has a fallback path, and an
 * exception escaping here would fail an upload that could still succeed
 * another way.
 *
 * `language` is a hint, not a constraint — passing the wrong one is worse
 * than passing none, so callers that are unsure should omit it and let
 * Sarvam detect.
 */
export async function digitiseDocument(
  bytes: ArrayBuffer,
  filename: string,
  mimeType: string,
  language?: string
): Promise<DigitiseResult | null> {
  const apiKey = getSarvamApiKey()
  if (!apiKey) return null

  if (bytes.byteLength > MAX_FILE_BYTES) {
    console.error('Document too large for Sarvam Vision:', bytes.byteLength)
    return null
  }

  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mimeType }), filename)
  // Markdown rather than the default HTML: the text is going to be chunked
  // and embedded, and markdown carries structure (headings, tables) without
  // the tag noise that would otherwise dominate an embedding.
  form.append('output_format', 'md')
  if (language) form.append('language', language)

  let job: JobCreated | null = null
  try {
    const response = await fetch(`${BASE_URL}/job/digitise`, {
      method: 'POST',
      headers: headers(apiKey),
      body: form,
      signal: AbortSignal.timeout(60_000)
    })

    if (!response.ok) {
      console.error('Sarvam Vision digitise failed:', response.status, (await response.text()).slice(0, 300))
      return null
    }

    job = (await response.json()) as JobCreated
  } catch (error) {
    console.error('Sarvam Vision digitise error:', error instanceof Error ? error.message : error)
    return null
  }

  if (!job?.job_id) return null

  const finished = await waitForJob(job.job_id, apiKey)
  if (!finished) return null

  const markdown = await fetchResults(job.job_id, apiKey)
  if (!markdown) return null

  return {
    markdown,
    pages: finished.usage?.pages_total ?? 0,
    pagesFailed: finished.usage?.pages_failed ?? 0
  }
}

/** Poll until the job settles, or the timeout expires. */
async function waitForJob(jobId: string, apiKey: string): Promise<JobStatus | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)

    try {
      const response = await fetch(`${BASE_URL}/job/${jobId}/status`, {
        headers: headers(apiKey),
        signal: AbortSignal.timeout(30_000)
      })

      if (!response.ok) {
        console.error('Sarvam Vision status failed:', response.status)
        continue
      }

      const status = (await response.json()) as JobStatus

      if (status.status === 'completed') return status

      if (status.status === 'failed') {
        console.error('Sarvam Vision job failed:', jobId, status.error?.message)
        return null
      }
    } catch (error) {
      // A dropped poll is not a failed job; keep waiting until the deadline.
      console.error('Sarvam Vision status error:', error instanceof Error ? error.message : error)
    }
  }

  console.error('Sarvam Vision job timed out:', jobId)
  return null
}

/**
 * Fetch the finished text.
 *
 * The results payload is not a fixed shape across document types, so the
 * markdown is gathered defensively: whatever string-bearing fields the
 * pages expose, joined in order. Being liberal here is deliberate — an
 * unfamiliar shape should cost formatting, not the entire document.
 */
async function fetchResults(jobId: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch(`${BASE_URL}/job/${jobId}/results`, {
      headers: headers(apiKey),
      signal: AbortSignal.timeout(60_000)
    })

    if (!response.ok) {
      console.error('Sarvam Vision results failed:', response.status)
      return null
    }

    const payload = (await response.json()) as unknown
    const text = collectMarkdown(payload)
    return text.trim() ? text : null
  } catch (error) {
    console.error('Sarvam Vision results error:', error instanceof Error ? error.message : error)
    return null
  }
}

interface VisionBlock {
  text?: string
  layout_tag?: string
  reading_order?: number
}

interface VisionPage {
  page_num?: number
  blocks?: VisionBlock[]
}

interface VisionDocument {
  pages?: VisionPage[]
}

/**
 * Pull readable text out of a results payload.
 *
 * The real shape — confirmed against the live API rather than inferred — is
 * documents[] → pages[] → blocks[], where each block carries `text`, a
 * `layout_tag` and a `reading_order`. Order matters: blocks are not
 * necessarily stored in the order a human would read them.
 *
 * Blocks tagged `image` are OCR of pictures embedded in the page, and they
 * routinely repeat text that a neighbouring paragraph block already holds —
 * a real result contained both "Invoice / बिल" and a separate "बिल". Those
 * duplicates are dropped, but only when the text genuinely already appears,
 * so a picture carrying new information is still kept.
 *
 * Falls back to a generic walk for any payload that does not match, since an
 * unfamiliar shape should cost formatting rather than the whole document.
 */
export function collectMarkdown(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''

  const documents = (payload as { documents?: VisionDocument[] }).documents

  if (Array.isArray(documents)) {
    const out: string[] = []

    for (const doc of documents) {
      for (const page of [...(doc.pages ?? [])].sort(
        (a, b) => (a.page_num ?? 0) - (b.page_num ?? 0)
      )) {
        const blocks = [...(page.blocks ?? [])].sort(
          (a, b) => (a.reading_order ?? 0) - (b.reading_order ?? 0)
        )

        const pageParts: string[] = []
        for (const block of blocks) {
          const text = block.text?.trim()
          if (!text) continue

          // Only image blocks are deduped, and only against text already
          // captured on this page.
          if (block.layout_tag === 'image' && pageParts.some((p) => p.includes(text))) {
            continue
          }

          pageParts.push(text)
        }

        if (pageParts.length > 0) out.push(pageParts.join('\n'))
      }
    }

    if (out.length > 0) return out.join('\n\n')
  }

  return collectMarkdownLoosely(payload)
}

/** Last-resort traversal for a payload shape we do not recognise. */
function collectMarkdownLoosely(payload: unknown): string {
  const parts: string[] = []

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (typeof node !== 'object' || node === null) return

    const obj = node as Record<string, unknown>

    for (const key of ['markdown', 'md', 'content', 'text']) {
      const value = obj[key]
      if (typeof value === 'string' && value.trim()) {
        parts.push(value)
        return
      }
    }

    Object.values(obj).forEach(visit)
  }

  visit(payload)
  return parts.join('\n\n')
}
