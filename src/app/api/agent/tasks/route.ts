import { NextRequest, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChatRatelimit } from '@/lib/redis/ratelimit'
import { planTask } from '@/lib/agent/planner'
import { advanceTask } from '@/lib/agent/executor'

const MAX_GOAL_CHARS = 2000

// Matches the per-task route's threshold: long enough that a working
// invocation is never mistaken for a dead one, short enough that a stranded
// task resumes as soon as the user looks at their list.
const STALL_TIMEOUT_MS = 60_000

/**
 * Tasks a user may have in flight at once.
 *
 * One, not several. An agent makes many model calls per step, and running
 * two at once was measured blowing straight through Groq's free-tier rate
 * limit - one task died at its first step with a 429 while the other
 * starved. Concurrency here buys nothing the user can use and costs both
 * tasks.
 */
const MAX_ACTIVE_TASKS = 1

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  const limit = await getChatRatelimit().limit(user.id)
  if (!limit.success) {
    return new Response('Too many requests — try again shortly.', { status: 429 })
  }

  const body = (await request.json().catch(() => ({}))) as { goal?: string; conversationId?: string }
  const goal = body.goal?.trim()

  if (!goal) return new Response('Missing goal', { status: 400 })

  // A task can run for minutes and spend a lot of model budget. Capping how
  // many run at once is the difference between a useful feature and a way
  // to exhaust the account's quota in one click.
  const { count } = await supabase
    .from('agent_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('status', ['planning', 'running'])

  if ((count ?? 0) >= MAX_ACTIVE_TASKS) {
    return new Response(
      `You already have ${MAX_ACTIVE_TASKS} tasks running. Wait for one to finish first.`,
      { status: 429 }
    )
  }

  // Planned before anything is written, so a goal that does not warrant a
  // task leaves no half-created row behind and the caller can just answer
  // normally.
  const plan = await planTask(goal.slice(0, MAX_GOAL_CHARS))

  if (!plan.worthPlanning) {
    return Response.json(
      { planned: false, reason: plan.reason ?? 'This is better answered directly.' },
      { status: 200 }
    )
  }

  const { data: task, error } = await supabase
    .from('agent_tasks')
    .insert({
      user_id: user.id,
      conversation_id: body.conversationId ?? null,
      goal: goal.slice(0, MAX_GOAL_CHARS),
      status: 'running'
    })
    .select('id')
    .single()

  if (error || !task) {
    console.error('Could not create agent task:', error)
    return new Response('Could not create the task', { status: 500 })
  }

  // Steps are written with the admin client: agent_steps is deliberately
  // read-only to authenticated, so a user cannot edit a plan mid-run and
  // corrupt the context later steps depend on.
  const admin = createAdminClient()
  const { error: stepsError } = await admin.from('agent_steps').insert(
    plan.steps.map((step, index) => ({
      task_id: task.id,
      user_id: user.id,
      step_index: index,
      title: step.title
    }))
  )

  if (stepsError) {
    console.error('Could not create agent steps:', stepsError)
    await admin
      .from('agent_tasks')
      .update({ status: 'failed', error_message: 'Could not save the plan.' })
      .eq('id', task.id)
    return new Response('Could not save the plan', { status: 500 })
  }

  // Execution starts after the response, so the caller gets the plan
  // immediately and can render it while the work begins.
  after(async () => {
    try {
      await advanceTask(admin, task.id, user.id)
    } catch (error) {
      console.error('Agent task execution failed:', task.id, error)
      await admin
        .from('agent_tasks')
        .update({ status: 'failed', error_message: 'The task stopped unexpectedly.' })
        .eq('id', task.id)
    }
  })

  return Response.json({
    planned: true,
    taskId: task.id,
    steps: plan.steps.map((s, i) => ({ index: i, title: s.title }))
  })
}

export async function GET(): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data } = await supabase
    .from('agent_tasks')
    .select('id, goal, status, summary, error_message, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(20)

  // Restart anything left stranded.
  //
  // Execution runs in after(), which the platform may cut short — a killed
  // invocation leaves a task marked running with nobody working on it. The
  // per-task poll recovers this too, but only while someone has that task
  // open; a user who closes the tab would otherwise strand it forever.
  // Listing tasks is the moment they have come back to look, which makes it
  // the natural place to pick the work back up. No cron is involved: the
  // Hobby plan's single slot is already spoken for.
  const stalled = (data ?? []).filter(
    (task) =>
      (task.status === 'running' || task.status === 'planning') &&
      Date.now() - new Date(task.updated_at).getTime() > STALL_TIMEOUT_MS
  )

  if (stalled.length > 0) {
    const admin = createAdminClient()
    after(async () => {
      // Sequential, not parallel: these are the same rate-limited model
      // calls that stalled them, and resuming several at once would
      // reproduce the failure that stranded them.
      for (const task of stalled) {
        try {
          await advanceTask(admin, task.id, user.id)
        } catch (error) {
          console.error('Resuming stalled agent task failed:', task.id, error)
        }
      }
    })
  }

  return Response.json({ tasks: data ?? [] })
}
