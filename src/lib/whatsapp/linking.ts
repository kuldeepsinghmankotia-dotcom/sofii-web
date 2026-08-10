import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

// Linking a WhatsApp number to a Sofii account.
//
// The webhook knows only a phone number, and a phone number in a payload
// proves nothing on its own — it is whatever the sender's device reports,
// vouched for only by the signature on the envelope. Before any message is
// treated as a particular user's, that number has to be tied to an account
// by someone who could demonstrate control of both.
//
// The proof is a short code: generated while signed in on the web (proving
// the account), then sent from the phone in question (proving the number).

// Unambiguous alphabet: no O/0, I/1, S/5, Z/2. This gets read off a screen
// and typed into a phone by hand, often on a small screen, and a code that
// fails because someone typed O for 0 teaches them the feature is broken.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY346789'
const CODE_LENGTH = 6

// Long enough to walk to another device, short enough that a code left on
// a shared screen stops working quickly.
const CODE_TTL_MINUTES = 15

export function generateLinkCode(): string {
  // Rejection-free selection would bias toward early characters if the
  // alphabet did not divide 256; 28 characters does not, so use rejection
  // sampling via crypto values rather than modulo on Math.random.
  const bytes = new Uint8Array(CODE_LENGTH * 2)
  crypto.getRandomValues(bytes)

  let code = ''
  for (let i = 0; code.length < CODE_LENGTH && i < bytes.length; i++) {
    // 252 is the largest multiple of 28 under 256; values above it are
    // discarded so every character stays equally likely.
    if (bytes[i] >= 252) continue
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }

  // Astronomically unlikely, but a short code must never be returned.
  while (code.length < CODE_LENGTH) {
    const extra = new Uint8Array(1)
    crypto.getRandomValues(extra)
    if (extra[0] < 252) code += CODE_ALPHABET[extra[0] % CODE_ALPHABET.length]
  }

  return code
}

export async function createLinkCode(supabase: Client, userId: string): Promise<string> {
  const code = generateLinkCode()
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString()

  const { error } = await supabase
    .from('whatsapp_link_codes')
    .insert({ code, user_id: userId, expires_at: expiresAt })

  if (error) throw error
  return code
}

/**
 * Recognise a linking attempt.
 *
 * Accepts "LINK ABC123" and a bare "ABC123", because people will send both.
 * Returns the normalised code, or null when the message is ordinary text.
 */
export function parseLinkCommand(text: string): string | null {
  const trimmed = text.trim().toUpperCase()
  const withoutPrefix = trimmed.startsWith('LINK ') ? trimmed.slice(5).trim() : trimmed

  // Anchored and length-checked so a normal sentence can never be mistaken
  // for a code.
  if (!new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(withoutPrefix)) return null
  return withoutPrefix
}

export interface LinkResult {
  status: 'linked' | 'invalid' | 'expired' | 'already-used'
  userId?: string
}

/**
 * Redeem a code and bind the number to the account.
 *
 * Uses the service-role client: it writes a row for a user who has no
 * session here, which is the whole point of the webhook.
 */
export async function redeemLinkCode(
  supabase: Client,
  code: string,
  phone: string,
  displayName: string | null
): Promise<LinkResult> {
  const { data: row } = await supabase
    .from('whatsapp_link_codes')
    .select('code, user_id, expires_at, used_at')
    .eq('code', code)
    .maybeSingle()

  if (!row) return { status: 'invalid' }
  if (row.used_at) return { status: 'already-used' }
  if (new Date(row.expires_at).getTime() < Date.now()) return { status: 'expired' }

  // Marked used before the link is written, and conditionally on it still
  // being unused, so two messages carrying the same code cannot both
  // succeed — the second update matches no rows.
  const { data: claimed } = await supabase
    .from('whatsapp_link_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code', code)
    .is('used_at', null)
    .select('code')

  if (!claimed || claimed.length === 0) return { status: 'already-used' }

  // upsert, not insert: re-linking a number that was previously attached to
  // another account should move it, not fail. The code proves the new owner
  // controls both sides, which is the same proof the first link required.
  const { error } = await supabase
    .from('whatsapp_links')
    .upsert({ phone, user_id: row.user_id, display_name: displayName }, { onConflict: 'phone' })

  if (error) {
    console.error('Failed to write WhatsApp link:', error)
    return { status: 'invalid' }
  }

  return { status: 'linked', userId: row.user_id }
}

export interface LinkedAccount {
  userId: string
  conversationId: string | null
}

/** Which account, if any, a number belongs to. */
export async function findLinkedAccount(
  supabase: Client,
  phone: string
): Promise<LinkedAccount | null> {
  const { data } = await supabase
    .from('whatsapp_links')
    .select('user_id, conversation_id')
    .eq('phone', phone)
    .maybeSingle()

  if (!data) return null
  return { userId: data.user_id, conversationId: data.conversation_id }
}

export async function setLinkedConversation(
  supabase: Client,
  phone: string,
  conversationId: string
): Promise<void> {
  await supabase.from('whatsapp_links').update({ conversation_id: conversationId }).eq('phone', phone)
}

/**
 * Claim a message id, returning false if it has already been handled.
 *
 * Meta redelivers until it receives a 200 and will re-send the same message
 * on its own schedule. Without this a slow reply is answered twice, which
 * both confuses the user and doubles the model spend. The primary key does
 * the work: the second insert conflicts.
 */
export async function claimMessage(supabase: Client, messageId: string): Promise<boolean> {
  const { error } = await supabase
    .from('whatsapp_processed_messages')
    .insert({ message_id: messageId })

  // 23505 = unique_violation: seen before, so this is a redelivery.
  if (error?.code === '23505') return false

  if (error) {
    // Any other failure: process it. A duplicate reply is a far better
    // outcome than silently dropping a real message.
    console.error('Could not claim WhatsApp message:', error)
    return true
  }

  return true
}
