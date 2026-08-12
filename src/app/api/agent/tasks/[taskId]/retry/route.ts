import { NextRequest, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { advanceTask } from '@/lib/agent/executor'

// Resume a task that failed part-way.
//
// Without this a failed task is a dead end: the plan is still there, the
// completed steps still hold their results, and there is no way to pick any
// of it back up. That matters more than usual here because the most common
// failure is a rate limit — a transient condition that clears in under a
// minute, yet still cost the user everything.
//
// Only the failed and pending steps are reset. Re-running completed steps
// would discard good work and spend the model budget reproducing it, which
// is precisely what makes the rate limit likely to bite again.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<Response> {
  const { taskId } = await params
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: task } = await supabase
    .from('agent_tasks')
    .select('id, status')
    .eq('id', taskId)
    .maybeSingle()

  if (!task) return new Response('Not found', { status: 404 })

  if (task.status === 'done') {
    return new Response('That task already finished.', { status: 409 })
  }

  if (task.status === 'running') {
    return new Response('That task is already running.', { status: 409 })
  }

  const admin = createAdminClient()

  // Clear the failure from the steps that did not complete, so they are
  // eligible to run again. `done` steps are deliberately untouched.
  const { error: stepsError } = await admin
    .from('agent_steps')
    .update({ status: 'pending', error_message: null, started_at: null, finished_at: null })
    .eq('task_id', taskId)
    .in('status', ['failed', 'running'])

  if (stepsError) {
    console.error('Could not reset steps for retry:', stepsError)
    return new Response('Could not retry that task', { status: 500 })
  }

  const { error: taskError } = await admin
    .from('agent_tasks')
    .update({ status: 'running', error_message: null })
    .eq('id', taskId)

  if (taskError) {
    console.error('Could not mark task running for retry:', taskError)
    return new Response('Could not retry that task', { status: 500 })
  }

  after(async () => {
    try {
      await advanceTask(admin, taskId, user.id)
    } catch (error) {
      console.error('Agent task retry failed:', taskId, error)
      await admin
        .from('agent_tasks')
        .update({ status: 'failed', error_message: 'The task stopped unexpectedly.' })
        .eq('id', taskId)
    }
  })

  return new Response(null, { status: 204 })
}
