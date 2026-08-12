import { getGroqClient } from '@/lib/groq/client'
import { withRateLimitRetry } from './retry'
import { PLANNER_MODEL } from './model'

// Turning a goal into a plan.
//
// The plan is shown to the user before anything runs, which is the point:
// an agent that silently does eight things is impossible to trust or
// correct, and the moment to catch "that's not what I meant" is before the
// work, not after.

/**
 * Upper bound on plan length.
 *
 * Both a judgement limit and a speed limit. Past roughly this many steps a
 * plan stops being a plan and becomes a wish, with later steps written
 * before anything is known about what the earlier ones return — and every
 * step costs its own model round trip, so a six-step plan that could have
 * been three simply takes twice as long to say the same thing.
 *
 * Lowered from 8 after watching real plans: research goals were being split
 * into "define criteria", "search", "select", "gather details", "compare",
 * "summarise" where three steps covered the same ground.
 */
export const MAX_STEPS = 5

/** Below this, planning costs more than it saves. */
export const MIN_STEPS = 2

export interface PlanStep {
  title: string
}

export interface Plan {
  /** Whether the goal warrants a multi-step task at all. */
  worthPlanning: boolean
  steps: PlanStep[]
  /** Why planning was declined, for showing the user. */
  reason?: string
}

const PLANNER_PROMPT = `You break a user's goal into a short plan of concrete steps.

Rules:
- Only plan when the goal genuinely needs several distinct actions, such as
  researching multiple things, or gathering information and then acting on it.
- Do NOT plan for anything answerable in one reply — a fact, a definition, a
  calculation, a single reminder. Those should be answered directly.
- Each step must be one concrete action, phrased as an instruction.
- Steps run in order and can use earlier results.
- Between ${MIN_STEPS} and ${MAX_STEPS} steps — use the FEWEST that do the job.
- Combine naturally related work into one step. "Search for X and note their
  prices" is one step, not two. Do not add separate steps for deciding
  criteria, selecting from results, or restating findings; the step that
  gathers the information should also do the judging.
- The final step should produce the answer the user asked for.

Available capabilities: web search, reading a web page, exact calculation,
searching the user's own documents and past conversations, saving notes,
setting reminders, reading and creating calendar events.

Respond with JSON only:
{"worth_planning": true, "steps": [{"title": "..."}]}
or
{"worth_planning": false, "reason": "why a single reply is better"}`

/**
 * Validate a planner response.
 *
 * Separated from the model call so the parsing rules are testable without a
 * network round trip, and because this is where a malformed or over-eager
 * plan has to be caught: everything downstream treats these steps as
 * instructions to execute.
 */
export function parsePlan(raw: string): Plan {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    // A model that cannot return JSON is not one to hand a task list to.
    return { worthPlanning: false, steps: [], reason: 'Could not read the plan.' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { worthPlanning: false, steps: [], reason: 'Could not read the plan.' }
  }

  const obj = parsed as Record<string, unknown>

  if (obj.worth_planning === false) {
    return {
      worthPlanning: false,
      steps: [],
      reason: typeof obj.reason === 'string' ? obj.reason : undefined
    }
  }

  if (!Array.isArray(obj.steps)) {
    return { worthPlanning: false, steps: [], reason: 'The plan had no steps.' }
  }

  const steps: PlanStep[] = []
  for (const entry of obj.steps) {
    if (typeof entry !== 'object' || entry === null) continue
    const title = (entry as Record<string, unknown>).title
    if (typeof title !== 'string') continue
    const trimmed = title.trim()
    if (!trimmed) continue
    // Truncated rather than rejected: an over-long title is a cosmetic
    // problem, and discarding the step would silently change the plan.
    steps.push({ title: trimmed.slice(0, 200) })
  }

  if (steps.length < MIN_STEPS) {
    return {
      worthPlanning: false,
      steps: [],
      reason: 'This is better answered directly than turned into a task.'
    }
  }

  // Extra steps are dropped rather than the plan rejected: the first
  // MAX_STEPS are still a coherent plan, and refusing outright would lose
  // work the user asked for.
  return { worthPlanning: true, steps: steps.slice(0, MAX_STEPS) }
}

/** Ask the model for a plan. */
export async function planTask(goal: string, model = PLANNER_MODEL): Promise<Plan> {
  try {
    // Retried on rate limits like every other model call here: a 429
    // during planning surfaced as a bare "Planning failed", which reads to
    // the user as though the goal was rejected rather than as a transient
    // limit worth waiting out.
    const completion = await withRateLimitRetry(() =>
      getGroqClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PLANNER_PROMPT },
        { role: 'user', content: goal }
      ],
      // Planning is a structuring task, not a creative one; a low
      // temperature keeps the same goal producing a stable plan.
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    )

    const content = completion.choices[0]?.message?.content
    if (!content) return { worthPlanning: false, steps: [], reason: 'No plan was produced.' }

    return parsePlan(content)
  } catch (error) {
    console.error('Planning failed:', error instanceof Error ? error.message : error)
    return { worthPlanning: false, steps: [], reason: 'Planning failed.' }
  }
}
