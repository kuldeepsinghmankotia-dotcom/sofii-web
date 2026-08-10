// Shapes of the WhatsApp Cloud API webhook payload we actually use.
//
// Deliberately partial. Meta's payload is large, versioned, and mostly
// irrelevant here; typing only the fields this app reads means a change to
// anything else cannot break the build, and every field below is one we
// genuinely depend on.

export interface WhatsAppTextMessage {
  type: 'text'
  text: { body: string }
}

export interface WhatsAppAudioMessage {
  type: 'audio'
  audio: { id: string; mime_type?: string; voice?: boolean }
}

export interface WhatsAppImageMessage {
  type: 'image'
  image: { id: string; mime_type?: string; caption?: string }
}

export interface WhatsAppDocumentMessage {
  type: 'document'
  document: { id: string; mime_type?: string; filename?: string; caption?: string }
}

export interface WhatsAppUnsupportedMessage {
  // Everything else: stickers, location, contacts, reactions, video, …
  type: string
}

export type WhatsAppMessageBody =
  | WhatsAppTextMessage
  | WhatsAppAudioMessage
  | WhatsAppImageMessage
  | WhatsAppDocumentMessage
  | WhatsAppUnsupportedMessage

export type WhatsAppMessage = {
  /** Sender's phone number in E.164 without '+', e.g. 919876543210. */
  from: string
  /** Message id — the idempotency key for delivery retries. */
  id: string
  /** Unix seconds, as a string. */
  timestamp: string
} & WhatsAppMessageBody

export interface WhatsAppContact {
  wa_id: string
  profile?: { name?: string }
}

export interface WhatsAppChangeValue {
  messaging_product: 'whatsapp'
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  contacts?: WhatsAppContact[]
  messages?: WhatsAppMessage[]
  /** Delivery/read receipts — received constantly and ignored. */
  statuses?: unknown[]
}

export interface WhatsAppWebhookPayload {
  object?: string
  entry?: { id?: string; changes?: { value?: WhatsAppChangeValue; field?: string }[] }[]
}

/**
 * Flatten the deeply nested payload into the messages we care about.
 *
 * Meta batches: one POST can carry several entries, each with several
 * changes, each with several messages. Handling only entry[0].changes[0]
 * — the shape most examples show — silently drops messages under load,
 * which is exactly the kind of bug that only appears once real traffic
 * arrives.
 */
export function extractMessages(
  payload: WhatsAppWebhookPayload
): { message: WhatsAppMessage; phoneNumberId: string | null; profileName: string | null }[] {
  const out: { message: WhatsAppMessage; phoneNumberId: string | null; profileName: string | null }[] = []

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value?.messages?.length) continue

      const phoneNumberId = value.metadata?.phone_number_id ?? null

      for (const message of value.messages) {
        const profileName =
          value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null
        out.push({ message, phoneNumberId, profileName })
      }
    }
  }

  return out
}
