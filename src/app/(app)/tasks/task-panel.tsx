'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown, CircleDashed, Loader2, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { AssistantContent } from '../c/[conversationId]/message-content'

// Watching a task run.
//
// The plan is shown before and during execution, not just the result. An
// agent that works silently for two minutes and then produces an answer is
// impossible to trust: there is no way to tell whether it understood the
// goal, no way to stop it going the wrong way, and no way to judge the
// answer afterwards without re-doing the work yourself.

export interface TaskStep {
  step_index: number
  title: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  result: string | null
  error_message: string | null
  started_at?: string | null
}

/**
 * A ticking count of how long the current step has been working.
 *
 * The panel polls every 3s and always did — but a single research step runs
 * for one to five minutes, so nothing on screen changed for minutes at a
 * time and the whole thing read as frozen. People refreshed to find out
 * whether it was still alive. Nothing was wrong with the data; there was
 * simply no evidence of life.
 *
 * A number that moves every second is that evidence, and it costs one
 * timer rather than more requests.
 */
function useElapsed(since: string | null | undefined, active: boolean): string | null {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active || !since) return
    const timer = setInterval(() => queueMicrotask(() => setNow(Date.now())), 1000)
    return () => clearInterval(timer)
  }, [active, since])

  if (!since || !active) return null

  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

export interface AgentTask {
  id: string
  goal: string
  status: 'planning' | 'running' | 'done' | 'failed' | 'cancelled'
  summary: string | null
  error_message: string | null
  created_at: string
}

// Frequent enough that progress feels live, sparse enough that a five-minute
// task is not hundreds of requests. Polling rather than a socket matches how
// the rest of this app tracks background work (see reminder-poller).
const POLL_INTERVAL_MS = 3000

function isFinished(status: AgentTask['status']): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

/** Ticking elapsed time for the step currently running. */
function StepClock({ startedAt }: { startedAt?: string | null }) {
  const elapsed = useElapsed(startedAt, true)
  if (!elapsed) return null
  return (
    <span className="ml-2 rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 align-middle text-[11px] tabular-nums text-[var(--text-muted)]">
      {elapsed}
    </span>
  )
}

export default function TaskPanel({ task: initialTask }: { task: AgentTask }) {
  const [task, setTask] = useState(initialTask)
  const [steps, setSteps] = useState<TaskStep[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [retrying, setRetrying] = useState(false)
  const reducedMotion = useReducedMotion()
  // Held in a ref so the polling effect does not restart every tick.
  const finishedRef = useRef(isFinished(initialTask.status))

  const poll = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/agent/tasks/${task.id}`)
      if (!response.ok) return
      const data = (await response.json()) as { task: AgentTask; steps: TaskStep[] }
      // queueMicrotask: this project's lint rule forbids setting state
      // directly inside an effect's synchronous path.
      queueMicrotask(() => {
        setTask(data.task)
        setSteps(data.steps)
        finishedRef.current = isFinished(data.task.status)
      })
    } catch {
      // A dropped poll is not worth surfacing; the next one will catch up.
    }
  }, [task.id])

  useEffect(() => {
    void poll()
    if (finishedRef.current) return

    const timer = setInterval(() => {
      if (finishedRef.current) {
        clearInterval(timer)
        return
      }
      void poll()
    }, POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [poll])

  const retry = async (): Promise<void> => {
    setRetrying(true)
    try {
      const response = await fetch(`/api/agent/tasks/${task.id}/retry`, { method: 'POST' })
      if (!response.ok) throw new Error(await response.text())
      // Reflect the change immediately, and restart polling — finishedRef
      // is what stopped the timer when the task failed.
      finishedRef.current = false
      setTask((prev) => ({ ...prev, status: 'running', error_message: null }))
      void poll()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not retry')
    } finally {
      setRetrying(false)
    }
  }

  const cancel = async (): Promise<void> => {
    const response = await fetch(`/api/agent/tasks/${task.id}`, { method: 'DELETE' })
    if (!response.ok) {
      toast.error('Could not cancel the task')
      return
    }
    // The executor checks between steps, so the step in flight finishes
    // first — say so rather than implying an instant stop.
    toast.success('Stopping after the current step')
    void poll()
  }

  const running = !isFinished(task.status)
  const doneCount = steps.filter((s) => s.status === 'done').length

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--text)]">{task.goal}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            {running && (
              // A pulse is the cheapest possible proof the panel is live.
              // Research steps run for minutes, so without it the whole card
              // sits unchanged long enough to look broken.
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                  style={{ background: 'var(--accent-a)' }}
                />
                <span
                  className="relative inline-flex h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--accent-a)' }}
                />
              </span>
            )}
            {task.status === 'done' && `Finished · ${steps.length} steps`}
            {task.status === 'failed' && 'Failed'}
            {task.status === 'cancelled' && 'Cancelled'}
            {running && steps.length > 0 && `Working · step ${Math.min(doneCount + 1, steps.length)} of ${steps.length}`}
            {running && steps.length === 0 && 'Planning…'}
          </p>
        </div>

        {running && (
          <button
            onClick={() => void cancel()}
            className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--danger)]"
            aria-label="Cancel task"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <ol className="space-y-1">
        {steps.map((step) => {
          const isOpen = expanded === step.step_index
          const hasDetail = Boolean(step.result || step.error_message)

          return (
            <li key={step.step_index}>
              <button
                onClick={() => setExpanded(isOpen ? null : step.step_index)}
                disabled={!hasDetail}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)] disabled:hover:bg-transparent"
              >
                <span className="mt-0.5 shrink-0" aria-hidden="true">
                  {step.status === 'done' && <Check size={14} className="accent-icon" />}
                  {step.status === 'running' && (
                    <Loader2 size={14} className="accent-icon animate-spin" />
                  )}
                  {step.status === 'failed' && (
                    <TriangleAlert size={14} className="text-[var(--danger)]" />
                  )}
                  {(step.status === 'pending' || step.status === 'skipped') && (
                    <CircleDashed size={14} className="text-[var(--text-muted)]" />
                  )}
                </span>

                <span
                  className={`min-w-0 flex-1 ${
                    step.status === 'done' || step.status === 'running'
                      ? 'text-[var(--text)]'
                      : 'text-[var(--text-muted)]'
                  }`}
                >
                  {step.title}
                  {step.status === 'running' && (
                    <StepClock startedAt={step.started_at} />
                  )}
                </span>

                {hasDetail && (
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className={`mt-0.5 shrink-0 text-[var(--text-muted)] transition-transform ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                )}
              </button>

              <AnimatePresence initial={false}>
                {isOpen && hasDetail && (
                  <motion.div
                    initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="mx-2 mb-2 rounded-lg bg-[var(--bg-elevated)] p-3 text-xs leading-relaxed">
                      {step.error_message ? (
                        <p className="text-[var(--danger)]">{step.error_message}</p>
                      ) : (
                        <AssistantContent content={step.result ?? ''} />
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ol>

      {task.summary && (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
          <p className="mb-1.5 text-xs font-medium text-[var(--text)]">Answer</p>
          {/* Rendered, not raw. The answer is the point of the task, and
              research output is full of tables and lists — showing it as
              literal pipes and dashes wasted the work that produced it.
              Reuses the same renderer as chat so formatting is identical. */}
          <div className="text-sm">
            <AssistantContent content={task.summary} />
          </div>
        </div>
      )}

      {task.error_message && (
        <div className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-red-500/5 p-3">
          <p className="text-sm text-[var(--danger)]">{task.error_message}</p>
          {/* A failed task was previously a dead end — the plan and every
              completed step were still there with no way to pick them back
              up. That is a poor outcome for the most common failure, a rate
              limit, which clears in under a minute. Retrying keeps finished
              steps and re-runs only what did not complete. */}
          <button
            onClick={() => void retry()}
            disabled={retrying}
            className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-60"
          >
            {retrying ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            {retrying ? 'Resuming…' : 'Try again'}
          </button>
        </div>
      )}
    </div>
  )
}
