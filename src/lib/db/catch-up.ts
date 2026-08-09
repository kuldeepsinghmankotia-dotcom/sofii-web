import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

export interface CatchUpReminder {
  id: string
  content: string
  scheduled_at: string
}

export interface CatchUpDocument {
  id: string
  filename: string
  created_at: string
}

export interface CatchUpMemory {
  id: string
  content: string
}

export interface OpenLoop {
  conversation_id: string
  title: string
  question: string
  created_at: string
}

export interface CatchUp {
  daysAway: number | null
  overdueReminders: CatchUpReminder[]
  upcomingReminders: CatchUpReminder[]
  newDocuments: CatchUpDocument[]
  newMemories: CatchUpMemory[]
  openLoops: OpenLoop[]
}

// Below this, a returning visit isn't interesting enough to interrupt the
// normal composer view with a catch-up panel — someone who was here this
// morning doesn't need to be told what happened this morning.
const MIN_DAYS_AWAY_TO_SHOW = 1
const UPCOMING_WINDOW_DAYS = 7

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000)
}

/**
 * Everything a returning user needs to be caught up, in one round of
 * queries. All reads are RLS-scoped, so this is the user's own data only.
 *
 * Deliberately built from real database state rather than an LLM summary:
 * it renders on the landing page, so it has to be fast and cannot fail —
 * an API call here would put a slow, quota-limited dependency in front of
 * the app's front door.
 */
export async function getCatchUp(supabase: Client, lastActiveAt: string | null): Promise<CatchUp> {
  const now = new Date()
  const daysAway = lastActiveAt ? daysBetween(new Date(lastActiveAt), now) : null
  const since = lastActiveAt ?? new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const upcomingCutoff = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 86_400_000).toISOString()
  const nowIso = now.toISOString()

  const [overdue, upcoming, documents, memories, openLoops] = await Promise.all([
    // Reminders that came due while they were away.
    //
    // Matches 'fired' as well as 'pending', which matters: the in-app
    // reminder poller flips a due reminder to 'fired' the moment the app
    // is next open, so filtering on 'pending' alone found almost nothing
    // in practice (verified live — a reminder seeded 3 days overdue was
    // already 'fired' by the time the page rendered). A fired reminder is
    // exactly the case this panel exists for: it came due while the app
    // was closed, so its notification was never actually seen.
    // Bounded to the away window rather than all history, so this stays
    // "what you missed" and doesn't dredge up months of old items.
    supabase
      .from('reminders')
      .select('id, content, scheduled_at')
      .in('status', ['pending', 'fired'])
      .lt('scheduled_at', nowIso)
      .gt('scheduled_at', since)
      .order('scheduled_at', { ascending: false })
      .limit(5),

    supabase
      .from('reminders')
      .select('id, content, scheduled_at')
      .eq('status', 'pending')
      .gte('scheduled_at', nowIso)
      .lte('scheduled_at', upcomingCutoff)
      .order('scheduled_at', { ascending: true })
      .limit(5),

    // Documents that finished ingesting since they were last here —
    // relevant because ingestion is async and often completes long after
    // the upload, i.e. exactly while they were away.
    supabase
      .from('documents')
      .select('id, filename, created_at')
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5),

    supabase
      .from('memories')
      .select('id, content')
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5),

    findOpenLoops(supabase)
  ])

  return {
    daysAway,
    overdueReminders: (overdue.data ?? []) as CatchUpReminder[],
    upcomingReminders: (upcoming.data ?? []) as CatchUpReminder[],
    newDocuments: (documents.data ?? []) as CatchUpDocument[],
    newMemories: (memories.data ?? []) as CatchUpMemory[],
    openLoops
  }
}

const OPEN_LOOP_LOOKBACK_DAYS = 60
const OPEN_LOOP_MIN_AGE_HOURS = 12

/**
 * Conversations where Sofii asked something and the user never answered —
 * threads left mid-air rather than finished.
 *
 * Detected purely from existing data (no extra column, no LLM): the most
 * recent message in the conversation is from the assistant AND ends in a
 * question. That's a genuinely dangling loop, as opposed to a
 * conversation that simply ended because it was done.
 *
 * The age floor matters: a reply from two minutes ago ending in "want me
 * to dig deeper?" is an active conversation, not a forgotten one, and
 * surfacing it as abandoned would be wrong and annoying.
 */
async function findOpenLoops(supabase: Client): Promise<OpenLoop[]> {
  const lookback = new Date(Date.now() - OPEN_LOOP_LOOKBACK_DAYS * 86_400_000).toISOString()
  const maxAge = new Date(Date.now() - OPEN_LOOP_MIN_AGE_HOURS * 3_600_000).toISOString()

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, updated_at, messages(role, content, created_at)')
    .gt('updated_at', lookback)
    .lt('updated_at', maxAge)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error || !data) return []

  const loops: OpenLoop[] = []

  for (const conversation of data) {
    const messages = (conversation.messages ?? []) as {
      role: string
      content: string
      created_at: string
    }[]
    if (messages.length === 0) continue

    const last = messages.reduce((latest, m) =>
      new Date(m.created_at) > new Date(latest.created_at) ? m : latest
    )

    if (last.role !== 'assistant') continue
    // Trailing formatting/emoji is already stripped by the time it
    // matters here; a question mark in the final sentence is the signal.
    const trimmed = last.content.trim()
    if (!trimmed.endsWith('?')) continue

    // Show the question itself, not the whole reply — the point is to
    // remind the user what was asked, in one line.
    const question = trimmed.split('\n').filter(Boolean).pop()?.trim() ?? trimmed
    loops.push({
      conversation_id: conversation.id,
      title: conversation.title,
      question: question.length > 160 ? `${question.slice(0, 160)}…` : question,
      created_at: last.created_at
    })

    if (loops.length >= 3) break
  }

  return loops
}

export function shouldShowCatchUp(catchUp: CatchUp): boolean {
  // A first-ever/unknown visit (null) still shows it if there's anything
  // real to report — that's a returning user whose last_active_at simply
  // predates the column.
  if (catchUp.daysAway !== null && catchUp.daysAway < MIN_DAYS_AWAY_TO_SHOW) return false

  return (
    catchUp.overdueReminders.length > 0 ||
    catchUp.upcomingReminders.length > 0 ||
    catchUp.newDocuments.length > 0 ||
    catchUp.newMemories.length > 0 ||
    catchUp.openLoops.length > 0
  )
}

/**
 * Records this visit. Fire-and-forget by design: the home page must
 * render whether or not this write succeeds, and a failed timestamp
 * update only means the next visit's catch-up window is slightly stale.
 */
export async function touchLastActive(supabase: Client, userId: string): Promise<void> {
  try {
    await supabase
      .from('profiles')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', userId)
  } catch (error) {
    console.error('Could not record last-active time:', error)
  }
}
