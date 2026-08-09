import Link from 'next/link'
import { AlertCircle, ArrowRight, Bell, Brain, CalendarClock, FileText, MessageCircleQuestion } from 'lucide-react'
import type { CatchUp } from '@/lib/db/catch-up'

function formatWhen(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffDays = Math.round((date.getTime() - now.getTime()) / 86_400_000)

  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays === -1) return 'yesterday'
  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`
  return `in ${diffDays} days`
}

function Section({
  icon: Icon,
  title,
  tone = 'normal',
  children
}: {
  icon: typeof Bell
  title: string
  tone?: 'normal' | 'alert'
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon
          size={14}
          aria-hidden="true"
          className={tone === 'alert' ? 'text-[var(--danger)]' : 'accent-icon'}
        />
        <h2 className="text-xs font-semibold tracking-wide text-[var(--text)] uppercase">{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="text-sm leading-relaxed text-[var(--text-muted)]">{children}</div>
}

/**
 * "While you were away" — the surface built for someone who opens Sofii
 * once every few weeks rather than every day.
 *
 * The problem it solves: an assistant that quietly does work in the
 * background (reminders firing, documents finishing ingestion, facts being
 * learned) is invisible to an infrequent user, who lands on a blank
 * composer with no idea any of it happened. This makes the time they were
 * away legible in one screen, with zero setup required.
 */
export function CatchUpPanel({ catchUp }: { catchUp: CatchUp }) {
  const { daysAway, overdueReminders, upcomingReminders, newDocuments, newMemories, openLoops } =
    catchUp

  const heading =
    daysAway === null
      ? 'Welcome back'
      : daysAway >= 30
        ? `Welcome back — it's been about ${Math.round(daysAway / 30)} month${Math.round(daysAway / 30) === 1 ? '' : 's'}`
        : daysAway >= 7
          ? `Welcome back — it's been ${Math.floor(daysAway / 7)} week${Math.floor(daysAway / 7) === 1 ? '' : 's'}`
          : `Welcome back — it's been ${daysAway} day${daysAway === 1 ? '' : 's'}`

  return (
    <div className="w-full">
      <h1 className="mb-1 text-lg font-semibold text-[var(--text)]">{heading}</h1>
      <p className="mb-4 text-sm text-[var(--text-muted)]">Here&apos;s what happened while you were gone.</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {overdueReminders.length > 0 && (
          <Section icon={AlertCircle} title="Came due while you were away" tone="alert">
            {overdueReminders.map((r) => (
              <Row key={r.id}>
                <span className="text-[var(--text)]">{r.content}</span>
                <span className="mx-1.5">·</span>
                <span className="text-[var(--danger)]">was due {formatWhen(r.scheduled_at)}</span>
              </Row>
            ))}
            <Link
              href="/reminders"
              className="inline-flex items-center gap-1 pt-1 text-xs text-[var(--accent-a)] hover:underline"
            >
              All reminders <ArrowRight size={11} />
            </Link>
          </Section>
        )}

        {openLoops.length > 0 && (
          <Section icon={MessageCircleQuestion} title="You never answered">
            {openLoops.map((loop) => (
              <Row key={loop.conversation_id}>
                <Link
                  href={`/c/${loop.conversation_id}`}
                  className="text-[var(--accent-a)] hover:underline"
                >
                  {loop.title}
                </Link>
                <div className="mt-0.5 text-xs italic">&ldquo;{loop.question}&rdquo;</div>
              </Row>
            ))}
          </Section>
        )}

        {upcomingReminders.length > 0 && (
          <Section icon={CalendarClock} title="Coming up">
            {upcomingReminders.map((r) => (
              <Row key={r.id}>
                <span className="text-[var(--text)]">{r.content}</span>
                <span className="mx-1.5">·</span>
                {formatWhen(r.scheduled_at)}
              </Row>
            ))}
          </Section>
        )}

        {newDocuments.length > 0 && (
          <Section icon={FileText} title="Documents added">
            {newDocuments.map((d) => (
              <Row key={d.id}>
                <span className="text-[var(--text)]">{d.filename}</span>
              </Row>
            ))}
            <Link
              href="/documents"
              className="inline-flex items-center gap-1 pt-1 text-xs text-[var(--accent-a)] hover:underline"
            >
              All documents <ArrowRight size={11} />
            </Link>
          </Section>
        )}

        {newMemories.length > 0 && (
          <Section icon={Brain} title="Things I learned about you">
            {newMemories.map((m) => (
              <Row key={m.id}>{m.content}</Row>
            ))}
            <Link
              href="/memories"
              className="inline-flex items-center gap-1 pt-1 text-xs text-[var(--accent-a)] hover:underline"
            >
              All memories <ArrowRight size={11} />
            </Link>
          </Section>
        )}
      </div>
    </div>
  )
}
