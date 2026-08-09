import { fetchPublicUrl } from '@/lib/security/url-fetch-guard'

// Reads an arbitrary web page so Sofii can answer about a link the user
// pasted, rather than guessing from the URL or falling back to a search.
//
// Reuses lib/security/url-fetch-guard's SSRF protection (blocks private,
// loopback, link-local and cloud-metadata addresses, and re-validates
// every redirect hop) — fetching model-supplied URLs server-side without
// that is a straightforward path into the deployment's internal network.
const MAX_BYTES = 2_000_000
const MAX_EXTRACTED_CHARS = 6000
const FETCH_TIMEOUT_MS = 12_000

function stripHtml(html: string): string {
  return (
    html
      // Script/style/noscript contents are never readable prose, and
      // leaving them in swamps the extract with minified JS.
      .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Block-level tags become newlines so paragraphs/headings don't run
      // together into one wall of text.
      .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim()
  )
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? stripHtml(match[1]).slice(0, 200) : null
}

export interface ReadWebpageResult {
  title: string | null
  url: string
  text: string
  truncated: boolean
}

export async function readWebpage(rawUrl: string): Promise<ReadWebpageResult> {
  const response = await fetchPublicUrl(rawUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })

  if (!response.ok) {
    throw new Error(`That page returned status ${response.status}`)
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    throw new Error(
      `That URL is ${contentType || 'an unsupported type'}, not a readable web page. Images and other files can be added on the Documents page instead.`
    )
  }

  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_BYTES) throw new Error('That page is too large to read')

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) throw new Error('That page is too large to read')

  const html = new TextDecoder('utf-8').decode(buffer)
  const isHtml = contentType.includes('text/html')
  const text = isHtml ? stripHtml(html) : html.trim()

  if (!text) throw new Error('That page had no readable text')

  return {
    title: isHtml ? extractTitle(html) : null,
    url: response.url || rawUrl,
    text: text.slice(0, MAX_EXTRACTED_CHARS),
    truncated: text.length > MAX_EXTRACTED_CHARS
  }
}
