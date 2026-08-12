import { redirect } from 'next/navigation'
import { Bug, HelpCircle, Lightbulb, MessageSquarePlus } from 'lucide-react'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { getOwnRole } from '@/lib/db/profiles'
import { PageHeader } from '../../page-header'

const KIND_META: Record<string, { label: string; icon: typeof Lightbulb; className: string }> = {
  suggestion: { label: 'Idea', icon: Lightbulb, className: 'text-[var(--accent-a)]' },
  bug: { label: 'Bug', icon: Bug, className: 'text-[var(--danger)]' },
  help: { label: 'Help', icon: HelpCircle, className: 'text-[var(--accent-b)]' }
}

interface FeedbackRow {
  id: string
  kind: string
  message: string
  page_path: string | null
  user_agent: string | null
  created_at: string
}

// Admin-only inbox for everything sent through the in-app Help & feedback
// box. Without this the feedback table is only reachable by hand-writing
// SQL, which in practice means it never gets read — and unread feedback
// is worse than none, because it quietly teaches users their input is
// ignored.
export default async function AdminFeedbackPage() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  // Checked server-side rather than relying on the row-level policy alone:
  // a non-admin would simply see their own submissions here and think
  // that's the whole inbox, which is more confusing than being redirected.
  const role = await getOwnRole(supabase, user.id)
  if (role !== 'admin') redirect('/')

  const { data } = await supabase
    .from('feedback')
    .select('id, kind, message, page_path, user_agent, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = (data ?? []) as FeedbackRow[]

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <PageHeader
        icon={MessageSquarePlus}
        title="Feedback"
        description="Everything sent through the in-app Help & feedback box, newest first."
      />

      {rows.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          Nothing yet. Submissions from the Help &amp; feedback box in the sidebar land here.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((row) => {
          const meta = KIND_META[row.kind] ?? KIND_META.suggestion
          return (
            <div
              key={row.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                <span className={`inline-flex items-center gap-1 font-medium ${meta.className}`}>
                  <meta.icon size={12} aria-hidden="true" />
                  {meta.label}
                </span>
                <span>·</span>
                <span>{new Date(row.created_at).toLocaleString()}</span>
                {row.page_path && (
                  <>
                    <span>·</span>
                    <span className="font-mono">{row.page_path}</span>
                  </>
                )}
              </div>

              <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--text)]">
                {row.message}
              </p>

              {row.user_agent && (
                <p className="mt-2 truncate text-[11px] text-[var(--text-muted)]">
                  {row.user_agent}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
