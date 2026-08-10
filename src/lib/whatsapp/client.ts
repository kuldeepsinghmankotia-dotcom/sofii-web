// WhatsApp Cloud API client — sending messages and moving media.
//
// Talks to Meta's Graph API directly rather than through a BSP (Gupshup,
// Twilio, AiSensy). Direct is cheaper, has no per-message markup, and adds
// no third party to the path; the trade is that Meta's own onboarding and
// business verification have to be completed by hand.
//
// Everything here returns null or false on failure rather than throwing:
// this runs inside a webhook that Meta retries aggressively, and an
// exception escaping the handler turns one failed reply into a redelivery
// loop.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? 'v22.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

// Outbound calls sit inside a webhook Meta expects to return quickly.
const REQUEST_TIMEOUT_MS = 20_000

export interface WhatsAppConfig {
  accessToken: string
  phoneNumberId: string
  appSecret: string
  verifyToken: string
}

/**
 * Configuration, or null when WhatsApp is not set up.
 *
 * Null is the normal state until credentials exist, and every caller treats
 * it as "this integration is off" rather than an error — the app runs
 * exactly as before without it.
 */
export function getWhatsAppConfig(): WhatsAppConfig | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const appSecret = process.env.WHATSAPP_APP_SECRET
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN

  if (!accessToken || !phoneNumberId || !appSecret || !verifyToken) return null

  return { accessToken, phoneNumberId, appSecret, verifyToken }
}

export function isWhatsAppConfigured(): boolean {
  return getWhatsAppConfig() !== null
}

async function graphFetch(
  config: WhatsAppConfig,
  path: string,
  init: RequestInit = {}
): Promise<Response | null> {
  try {
    const response = await fetch(`${GRAPH_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        ...(init.headers ?? {})
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })

    if (!response.ok) {
      console.error('WhatsApp API error:', path, response.status, (await response.text()).slice(0, 400))
      return null
    }

    return response
  } catch (error) {
    console.error('WhatsApp API request failed:', path, error instanceof Error ? error.message : error)
    return null
  }
}

/** WhatsApp rejects text bodies over 4096 characters. */
export const MAX_TEXT_LENGTH = 4096

/**
 * Split a long reply across messages at natural boundaries.
 *
 * Assistant replies routinely exceed 4096 characters. Hard-slicing would
 * cut mid-word and mid-code-block, so paragraphs are kept whole where
 * possible and only an oversized paragraph is broken.
 */
export function splitForWhatsApp(text: string, limit = MAX_TEXT_LENGTH): string[] {
  if (text.length <= limit) return [text]

  const chunks: string[] = []
  let current = ''

  for (const paragraph of text.split('\n\n')) {
    if (paragraph.length > limit) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      // A single paragraph longer than the limit has no good seam; break it
      // on the limit rather than dropping any of it.
      for (let i = 0; i < paragraph.length; i += limit) {
        chunks.push(paragraph.slice(i, i + limit))
      }
      continue
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length > limit) {
      chunks.push(current)
      current = paragraph
    } else {
      current = candidate
    }
  }

  if (current) chunks.push(current)
  return chunks
}

/** Send a text reply. Returns false if any part failed. */
export async function sendWhatsAppText(
  config: WhatsAppConfig,
  to: string,
  text: string
): Promise<boolean> {
  const parts = splitForWhatsApp(text)

  for (const part of parts) {
    const response = await graphFetch(config, `/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        // Link previews add noise to what are usually short answers.
        text: { preview_url: false, body: part }
      })
    })

    if (!response) return false
  }

  return true
}

/**
 * Mark an incoming message read, so the user sees the blue ticks while the
 * model is still thinking. Purely cosmetic, and failure is ignored.
 */
export async function markWhatsAppRead(config: WhatsAppConfig, messageId: string): Promise<void> {
  await graphFetch(config, `/${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId })
  })
}

/**
 * Download media (a voice note, image or document) by id.
 *
 * Two steps: the id resolves to a short-lived URL, and that URL still needs
 * the access token — it is not public.
 */
export async function downloadWhatsAppMedia(
  config: WhatsAppConfig,
  mediaId: string
): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
  const metaResponse = await graphFetch(config, `/${mediaId}`)
  if (!metaResponse) return null

  const meta = (await metaResponse.json()) as { url?: string; mime_type?: string }
  if (!meta.url) return null

  try {
    const fileResponse = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })

    if (!fileResponse.ok) {
      console.error('WhatsApp media download failed:', fileResponse.status)
      return null
    }

    return {
      bytes: await fileResponse.arrayBuffer(),
      mimeType: meta.mime_type ?? 'application/octet-stream'
    }
  } catch (error) {
    console.error('WhatsApp media download error:', error instanceof Error ? error.message : error)
    return null
  }
}

/** Upload media and return its id, for sending it back. */
export async function uploadWhatsAppMedia(
  config: WhatsAppConfig,
  bytes: ArrayBuffer,
  mimeType: string,
  filename: string
): Promise<string | null> {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', mimeType)
  form.append('file', new Blob([bytes], { type: mimeType }), filename)

  const response = await graphFetch(config, `/${config.phoneNumberId}/media`, {
    method: 'POST',
    body: form
  })

  if (!response) return null

  const result = (await response.json()) as { id?: string }
  return result.id ?? null
}

/**
 * Send a voice note.
 *
 * WhatsApp only accepts OGG/Opus for audio, so the caller must transcode —
 * Bulbul's WAV cannot be sent directly. Callers that cannot transcode
 * should fall back to text rather than sending nothing.
 */
export async function sendWhatsAppAudio(
  config: WhatsAppConfig,
  to: string,
  mediaId: string
): Promise<boolean> {
  const response = await graphFetch(config, `/${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'audio',
      audio: { id: mediaId }
    })
  })

  return response !== null
}
