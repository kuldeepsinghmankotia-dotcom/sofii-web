import { NextRequest, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { advanceTask } from '@/lib/agent/executor'

/**
 * A task is considered stalled if nothing has touched it in this long.
 *
 * Execution runs in after(), which the platform can cut short — a killed
 * invocation leaves a task marked running with nobody working on it. Rather
 * than a cron (the Hobby plan's single slot is already spoken for), the
 * client's own polling nudges it back to life: whoever is watching the task
 * is exactly who wants it finished.
 */
const STALL_TIMEOUT_MS = 60_000

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<Response> {
  const { taskId } = await params
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  // RLS scopes both reads to this user; no explicit filter needed.
  const [{ data: task }, { data: steps }] = await Promise.all([
    supabase
      .from('agent_tasks')
      .select('id, goal, status, summary, error_message, created_at, updated_at')
      .eq('id', taskId)
      .maybeSingle(),
    supabase
      .from('agent_steps')
      .select('step_index, title, status, result, error_message')
      .eq('task_id', taskId)
      .order('step_index', { ascending: true })
  ])

  if (!task) return new Response('Not found', { status: 404 })

  // Resume a task nothing is working on any more.
  if (task.status === 'running' && Date.now() - new Date(task.updated_at).getTime() > STALL_TIMEOUT_MS) {
    const admin = createAdminClient()
    after(async () => {
      try {
        await advanceTask(admin, taskId, user.id)
      } catch (error) {
        console.error('Resuming stalled agent task failed:', taskId, error)
      }
    })
  }

  return Response.json({ task, steps: steps ?? [] })
}

/** Cancel a running task. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<Response> {
  const { taskId } = await params
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  // The executor re-reads status between steps, so this takes effect at the
  // next boundary rather than needing to interrupt work already in flight.
  const { error } = await supabase
    .from('agent_tasks')
    .update({ status: 'cancelled' })
    .eq('id', taskId)
    .in('status', ['planning', 'running'])

  if (error) return new Response('Could not cancel the task', { status: 500 })

  return new Response(null, { status: 204 })
}
