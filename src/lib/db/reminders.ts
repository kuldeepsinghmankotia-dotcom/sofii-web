import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

export type ReminderStatus = 'pending' | 'fired' | 'cancelled'

export interface Reminder {
  id: string
  content: string
  scheduled_at: string
  status: ReminderStatus
}

export async function listPendingReminders(supabase: Client): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('id, content, scheduled_at, status')
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })

  if (error) throw error
  return data as Reminder[]
}

export async function listAllReminders(supabase: Client): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('id, content, scheduled_at, status')
    .order('scheduled_at', { ascending: true })

  if (error) throw error
  return data as Reminder[]
}

export async function createReminder(
  supabase: Client,
  params: { userId: string; content: string; scheduledAt: string }
): Promise<Reminder> {
  const { data, error } = await supabase
    .from('reminders')
    .insert({ user_id: params.userId, content: params.content, scheduled_at: params.scheduledAt })
    .select('id, content, scheduled_at, status')
    .single()

  if (error) throw error
  return data as Reminder
}

/**
 * Atomically flips every due-and-still-pending reminder to 'fired' and
 * returns exactly the rows it flipped. The `eq('status', 'pending')` in the
 * update (not just the initial read) is what makes this safe to call from
 * multiple polling browser tabs at once: a reminder already claimed by
 * another poll no longer matches the WHERE clause, so it comes back to at
 * most one caller instead of double-firing a notification.
 */
export async function claimDueReminders(supabase: Client): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from('reminders')
    .update({ status: 'fired' })
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .select('id, content, scheduled_at, status')

  if (error) throw error
  return data as Reminder[]
}

export async function cancelReminder(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from('reminders').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw error
}

export async function deleteReminder(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from('reminders').delete().eq('id', id)
  if (error) throw error
}
