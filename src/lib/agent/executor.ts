import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { Database } from '@/types/database'
import { getGroqClient } from '@/lib/groq/client'
import { TOOL_DEFINITIONS } from '@/lib/tools/definitions'
import { executeToolCall } from '@/lib/tools/execute'
import { isRateLimit, withRateLimitRetry } from './retry'

type Client = SupabaseClient<Database>

// Running a plan, one step at a time.
//
// Execution is deliberately resumable rather than a single long call. A
// serverless function has a hard ceiling on how long it may run, and a task
// that takes four minutes cannot depend on one invocation surviving that
// long. Each invocation advances as many steps as it safely can and then
// stops; whatever calls it again picks up exactly where it left off,
// because the position lives in the database rather than in a variable.

/**
 * Tool rounds allowed within a single step.
 *
 * Each round is a full model round trip, and on this model those dominate a
 * step's runtime - a measured step produced only 627 characters yet took
 * 318 seconds, with rate-limit backoff accounting for just 12 of them. The
 * time is round trips, not tokens, so cutting the ceiling cuts the worst
 * case directly. Two rounds still allow "call a tool, then answer using
 * it", which is what almost every step actually needs.
 */
const MAX_TOOL_ROUNDS_PER_STEP = 2

/**
 * Ceiling on a step's own output.
 *
 * A step result is an intermediate note for the next step, not an essay,
 * and generation time scales with length. Prior context is trimmed to 1200
 * characters downstream anyway, so anything beyond this is written at cost
 * and then discarded.
 */
const STEP_MAX_TOKENS = 900

/**
 * How long one invocation may keep working.
 *
 * Comfortably inside the platform's 300s function limit, with room for the
 * step in flight to finish and be written down. Being killed mid-step is
 * the one outcome worth spending margin to avoid: the step's work is lost
 * but its status still says running.
 */
const INVOCATION_BUDGET_MS = 150_000

const STEP_PROMPT = `You are executing one step of a larger plan.

Do only the step you are given — not the ones after it. Use tools when you
need real information; never invent facts you could look up. Finish with a
short, concrete account of what you found or did, written so a later step
can use it. If the step cannot be completed, say plainly why.`

export interface StepRow {
  id: string
  step_index: number
  title: string
  status: string
  result: string | null
}

/**
 * How much of each earlier step's result to carry into the next one, and how
 * much prior context to carry in total.
 *
 * Passing every earlier result in full made context grow quadratically: by
 * step five, four complete research outputs travelled with every request.
 * That is slow twice over — more tokens to send and to read — and it is the
 * fastest way to exhaust a per-minute token budget, which is exactly what
 * kept failing research tasks part-way through.
 *
 * The most recent steps are kept whole-ish and older ones trimmed, because
 * a step almost always builds on what immediately preceded it. Nothing is
 * dropped silently: a trimmed result says so, so the model knows it is
 * seeing an excerpt rather than everything that was found.
 */
const PRIOR_RESULT_CHARS = 1200
const PRIOR_CONTEXT_TOTAL_CHARS = 6000

export function buildPriorContext(steps: StepRow[], currentIndex: number): string {
  const earlier = steps
    .filter((s) => s.step_index < currentIndex && s.result)
    // Most recent first, so the closest work survives the budget.
    .sort((a, b) => b.step_index - a.step_index)

  const blocks: string[] = []
  let used = 0

  for (const s of earlier) {
    const result = s.result as string
    const trimmed =
      result.length > PRIOR_RESULT_CHARS
        ? `${result.slice(0, PRIOR_RESULT_CHARS)}\n[…trimmed]`
        : result
    const block = `Step ${s.step_index + 1} (${s.title}):\n${trimmed}`

    if (used + block.length > PRIOR_CONTEXT_TOTAL_CHARS) {
      // Out of budget. Say that older steps exist rather than letting the
      // model assume this is the complete history.
      blocks.push(`[…${earlier.length - blocks.length} earlier step(s) omitted for length]`)
      break
    }

    blocks.push(block)
    used += block.length
  }

  // Restore chronological order for reading.
  return blocks.reverse().join('\n\n')
}

export interface ExecuteResult {
  status: 'done' | 'running' | 'failed'
  completedSteps: number
}

/**
 * Advance a task as far as this invocation allows.
 *
 * Returns 'running' when there is more to do — the caller is expected to
 * call again. Returns 'done' or 'failed' when the task is finished.
 */
export async function advanceTask(
  supabase: Client,
  taskId: string,
  userId: string
): Promise<ExecuteResult> {
  const startedAt = Date.now()
  let completed = 0

  const { data: task } = await supabase
    .from('agent_tasks')
    .select('id, goal, status, conversation_id')
    .eq('id', taskId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!task) return { status: 'failed', completedSteps: 0 }

  // Cancelled and finished tasks are left alone. Checked on every
  // invocation rather than only at the start, so a cancellation lands
  // between steps instead of being ignored until the end.
  if (task.status === 'cancelled' || task.status === 'done' || task.status === 'failed') {
    return { status: task.status === 'done' ? 'done' : 'failed', completedSteps: 0 }
  }

  const { data: steps } = await supabase
    .from('agent_steps')
    .select('id, step_index, title, status, result')
    .eq('task_id', taskId)
    .order('step_index', { ascending: true })

  if (!steps || steps.length === 0) {
    await failTask(supabase, taskId, 'This task had no steps to run.')
    return { status: 'failed', completedSteps: 0 }
  }

  for (const step of steps as StepRow[]) {
    if (step.status === 'done' || step.status === 'skipped') continue

    // Stop before starting a step that cannot finish inside the budget,
    // rather than being killed halfway through one.
    if (Date.now() - startedAt > INVOCATION_BUDGET_MS) {
      return { status: 'running', completedSteps: completed }
    }

    // Re-read the task's status between steps so a cancellation from the UI
    // takes effect promptly instead of after the whole plan.
    //
    // This write is also a heartbeat, and that part is load-bearing. Stall
    // detection asks when the task was last touched, but a running step only
    // updates *step* rows — so a genuinely busy task looked abandoned after
    // 60s and picked up a second runner. Two invocations then worked the
    // same plan at once, doubling the model spend and tripping the rate
    // limit that failed this task twice over.
    const { data: current } = await supabase
      .from('agent_tasks')
      .update({ status: 'running' })
      .eq('id', taskId)
      .in('status', ['running', 'planning'])
      .select('status')
      .maybeSingle()

    // No row came back: something else finished, failed or cancelled this
    // task while we were working. Stop rather than press on.
    if (!current) {
      return { status: 'failed', completedSteps: completed }
    }

    const outcome = await runStep(supabase, {
      taskId,
      userId,
      goal: task.goal,
      conversationId: task.conversation_id,
      step,
      earlierSteps: steps as StepRow[]
    })

    if (!outcome.ok) {
      // One failed step fails the task. Continuing would build later steps
      // on a gap, and a confidently wrong summary is worse than an honest
      // failure.
      await failTask(
        supabase,
        taskId,
        `Step ${step.step_index + 1} couldn't be completed. ${explainFailure(outcome.error)}`
      )
      return { status: 'failed', completedSteps: completed }
    }

    completed++
  }

  const summary = await summarise(supabase, taskId, task.goal)

  await supabase
    .from('agent_tasks')
    .update({ status: 'done', summary })
    .eq('id', taskId)

  return { status: 'done', completedSteps: completed }
}

async function runStep(
  supabase: Client,
  params: {
    taskId: string
    userId: string
    goal: string
    conversationId: string | null
    step: StepRow
    earlierSteps: StepRow[]
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { step, userId, goal, earlierSteps, conversationId } = params

  await supabase
    .from('agent_steps')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', step.id)

  // Only completed steps carry context forward; a pending step has nothing
  // to say, and including its title would read as though it had run.
  const priorContext = buildPriorContext(earlierSteps, step.step_index)

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: STEP_PROMPT },
    {
      role: 'user',
      content: [
        `Overall goal: ${goal}`,
        priorContext ? `What earlier steps found:\n${priorContext}` : null,
        `Your step: ${step.title}`
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ]

  try {
    const groq = getGroqClient()
    let result = ''

    for (let round = 0; round <= MAX_TOOL_ROUNDS_PER_STEP; round++) {
      const isFinal = round === MAX_TOOL_ROUNDS_PER_STEP

      // Withdrawing the tools on the final round is not enough on its own.
      // Groq rejects the whole request with "Tool choice is none, but model
      // called a tool" if the model reaches for one anyway — a hard 400 that
      // fails the step rather than degrading. Lowering the round ceiling made
      // this land far more often, because the tool-free round now arrives
      // while the model still wants to search. So it is told, not just
      // starved.
      if (isFinal) {
        messages.push({
          role: 'user',
          content:
            'You have no tools left for this step. Answer now using only what you already found above. If it is incomplete, say what you have and what is missing.'
        })
      }

      let completion
      try {
        completion = await withRateLimitRetry(() =>
          groq.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            messages,
            max_tokens: STEP_MAX_TOKENS,
            ...(isFinal ? {} : { tools: TOOL_DEFINITIONS, tool_choice: 'auto' as const })
          })
        )
      } catch (error) {
        // If the model insisted on a tool after they were withdrawn, and an
        // earlier round already produced something, keep that rather than
        // throwing away a step's real work over its closing sentence.
        const message = error instanceof Error ? error.message : String(error)
        if (isFinal && result.trim() && /tool choice is none/i.test(message)) {
          console.warn('Final round wanted a tool; keeping the result already gathered.')
          break
        }
        throw error
      }

      const choice = completion.choices[0]?.message
      if (!choice) break
      if (choice.content) result = choice.content

      const toolCalls = choice.tool_calls ?? []
      if (toolCalls.length === 0) break

      messages.push({ role: 'assistant', content: choice.content ?? null, tool_calls: toolCalls })

      const results = await Promise.all(
        toolCalls.map(async (call) => {
          if (call.type !== 'function') {
            return { role: 'tool' as const, tool_call_id: call.id, content: 'Unsupported tool type.' }
          }
          const content = await executeToolCall(
            { name: call.function.name, argumentsJson: call.function.arguments },
            supabase,
            userId,
            { conversationId: conversationId ?? undefined }
          )
          return { role: 'tool' as const, tool_call_id: call.id, content }
        })
      )

      messages.push(...results)
    }

    const trimmed = result.trim()
    if (!trimmed) return { ok: false, error: 'The step produced no result.' }

    await supabase
      .from('agent_steps')
      .update({ status: 'done', result: trimmed, finished_at: new Date().toISOString() })
      .eq('id', step.id)

    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Logged in full; stored and shown in the sanitised form only.
    console.error('Agent step failed:', step.id, message)

    await supabase
      .from('agent_steps')
      .update({
        status: 'failed',
        error_message: explainFailure(message),
        finished_at: new Date().toISOString()
      })
      .eq('id', step.id)

    return { ok: false, error: message }
  }
}

/**
 * Write the answer the user actually asked for.
 *
 * A list of step results is a transcript, not an answer — the point of the
 * task was the conclusion, so it gets composed explicitly rather than left
 * for the user to assemble.
 */
async function summarise(supabase: Client, taskId: string, goal: string): Promise<string> {
  const { data: steps } = await supabase
    .from('agent_steps')
    .select('step_index, title, result')
    .eq('task_id', taskId)
    .order('step_index', { ascending: true })

  const transcript = (steps ?? [])
    .filter((s) => s.result)
    .map((s) => `Step ${s.step_index + 1} (${s.title}):\n${s.result}`)
    .join('\n\n')

  if (!transcript) return 'The task finished without producing any results.'

  try {
    const completion = await getGroqClient().chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content:
            'Answer the original goal using the findings below. Write the answer itself, not a description of the process. Be concrete and brief. If the findings do not actually answer the goal, say so.'
        },
        { role: 'user', content: `Goal: ${goal}\n\nFindings:\n${transcript}` }
      ],
      // The summary is one more round trip on a slow model; the answer to a
      // research question does not need to be long, and length here is paid
      // for in latency the user is waiting on.
      max_tokens: 1200
    })

    return completion.choices[0]?.message?.content?.trim() || transcript
  } catch {
    // A failed summary must not fail a task whose work is already done —
    // the transcript is a worse answer, not no answer.
    return transcript
  }
}

/**
 * Turn a provider error into something worth showing a user.
 *
 * Raw provider messages are not fit to display: the observed rate-limit
 * error carried our organisation id, the service tier, exact token counts
 * and a billing upgrade link. None of that is the user's business, and the
 * organisation id in particular should not leave the server. The full text
 * still goes to the log, where it is actually useful.
 */
export function explainFailure(raw: string): string {
  if (isRateLimit(raw)) {
    return 'Sofii hit its usage limit part-way through. Try again in a minute — completed steps are kept.'
  }
  if (/timeout|timed out|abort/i.test(raw)) {
    return 'A step took too long to respond. Try again.'
  }
  return 'Something went wrong on our side. Try again in a moment.'
}

async function failTask(supabase: Client, taskId: string, message: string): Promise<void> {
  await supabase.from('agent_tasks').update({ status: 'failed', error_message: message }).eq('id', taskId)
}
