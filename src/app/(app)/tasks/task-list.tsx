'use client'

import { useState, type FormEvent } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import TaskPanel, { type AgentTask } from './task-panel'

const EXAMPLES = [
  'Compare three budget airlines flying Delhi to Bangkok and tell me which is best for a 5-day trip',
  'Find what the new income tax slabs are this year and work out what I owe on 18 lakh',
  'Research three good CRM tools for a small business and summarise the trade-offs'
]

export default function TaskList({ initialTasks }: { initialTasks: AgentTask[] }) {
  const [tasks, setTasks] = useState(initialTasks)
  const [goal, setGoal] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmed = goal.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    try {
      const response = await fetch('/api/agent/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: trimmed })
      })

      if (!response.ok) throw new Error(await response.text())

      const data = (await response.json()) as
        | { planned: false; reason: string }
        | { planned: true; taskId: string }

      // The planner declines anything answerable in one reply. Saying so —
      // and pointing at the chat — is more useful than manufacturing a
      // two-step plan to look busy.
      if (!data.planned) {
        toast.info(data.reason, { description: 'Ask this in a normal chat instead.' })
        return
      }

      setTasks((prev) => [
        {
          id: data.taskId,
          goal: trimmed,
          status: 'running',
          summary: null,
          error_message: null,
          created_at: new Date().toISOString()
        },
        ...prev
      ])
      setGoal('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start the task')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-2">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits, shift+enter breaks the line — matching the
            // composer everywhere else in the app.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit(e)
            }
          }}
          rows={2}
          placeholder="What should Sofii work on?"
          className="accent-ring w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-input-strong)] p-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <button
          type="submit"
          disabled={submitting || !goal.trim()}
          className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--accent-gradient-text)] disabled:opacity-60"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {submitting ? 'Planning…' : 'Start task'}
        </button>
      </form>

      {tasks.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
          <p className="mb-2 text-sm text-[var(--text)]">Things worth handing over</p>
          <ul className="space-y-1.5">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  onClick={() => setGoal(example)}
                  className="text-left text-sm text-[var(--text-muted)] hover:text-[var(--accent-a)]"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskPanel key={task.id} task={task} />
        ))}
      </div>
    </div>
  )
}
