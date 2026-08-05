'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  cancelReminder,
  createReminder,
  deleteReminder,
  type Reminder,
  type ReminderStatus
} from '@/lib/db/reminders'
import { Tooltip } from '../tooltip'

function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function defaultDatetimeValue(): string {
  return toLocalDatetimeInputValue(new Date(Date.now() + 60 * 60 * 1000))
}

function statusLabel(status: ReminderStatus): string {
  if (status === 'pending') return 'Upcoming'
  if (status === 'fired') return 'Done'
  return 'Cancelled'
}

export default function ReminderList({ initialReminders }: { initialReminders: Reminder[] }) {
  const [reminders, setReminders] = useState<Reminder[]>(initialReminders)
  const [content, setContent] = useState('')
  const [when, setWhen] = useState(defaultDatetimeValue())

  const handleAdd = async (): Promise<void> => {
    if (!content.trim() || !when) return
    const scheduledAt = new Date(when)
    if (Number.isNaN(scheduledAt.getTime())) return

    const supabase = createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) return

    const reminder = await createReminder(supabase, {
      userId: user.id,
      content: content.trim(),
      scheduledAt: scheduledAt.toISOString()
    })
    setReminders((prev) => [...prev, reminder].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)))
    setContent('')
  }

  const handleCancel = async (id: string): Promise<void> => {
    const supabase = createClient()
    await cancelReminder(supabase, id)
    setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r)))
  }

  const handleDelete = async (id: string): Promise<void> => {
    const supabase = createClient()
    await deleteReminder(supabase, id)
    setReminders((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
          placeholder="What should I remind you about?"
          className="min-w-[200px] flex-1 rounded-lg border border-[var(--border)] bg-white/[0.03] p-3 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-white/[0.03] p-3 text-[var(--text)] outline-none"
        />
        <button
          onClick={handleAdd}
          className="rounded-lg px-5 py-3 font-medium text-black disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          Add
        </button>
      </div>

      <div className="space-y-2">
        {reminders.length === 0 && <p className="text-[var(--text-muted)]">No reminders yet.</p>}
        {reminders.map((reminder) => (
          <div
            key={reminder.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-white/[0.03] p-3"
          >
            <div className="min-w-0">
              <div className="truncate text-[var(--text)]">{reminder.content}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {new Date(reminder.scheduled_at).toLocaleString()} · {statusLabel(reminder.status)}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {reminder.status === 'pending' && (
                <button
                  onClick={() => handleCancel(reminder.id)}
                  className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>
              )}
              <Tooltip label="Delete reminder">
                <button
                  onClick={() => handleDelete(reminder.id)}
                  aria-label="Delete reminder"
                  className="rounded p-1 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--danger)]"
                >
                  <X size={14} />
                </button>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
