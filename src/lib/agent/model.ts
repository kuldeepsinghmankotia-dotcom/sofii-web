/**
 * Which model the agent plans and executes with.
 *
 * Agent work is the heaviest token consumer in the app — several calls per
 * step, each carrying tool results — so it is the first thing to hit a
 * per-minute ceiling, and the choice of model is really a choice of ceiling.
 *
 * Measured on the same account:
 *   openai/gpt-oss-120b      8,000 tokens/min
 *   llama-3.3-70b-versatile 12,000 tokens/min
 *
 * llama-3.3 was tried for that extra headroom and reverted. It advertises
 * tool calling, and a trivial one-function probe worked, but against this
 * app's actual tool definitions it failed outright:
 *
 *   400 Failed to call a function. Please adjust your prompt.
 *
 * More tokens per minute is worth nothing from a model that cannot reliably
 * call the tools the agent is built on, so gpt-oss-120b stays despite the
 * lower ceiling. Worth re-testing if the tool schemas are ever simplified.
 *
 * Overridable by env so the model can be changed without a deploy, and so
 * this reverts to the previous behaviour with one variable if the quality
 * trade turns out badly.
 */
export const AGENT_MODEL = process.env.GROQ_AGENT_MODEL ?? 'openai/gpt-oss-120b'

/**
 * The planner's model.
 *
 * Kept separate deliberately. Planning is one short structured call, so it
 * costs almost nothing against the token budget, and a better plan pays for
 * itself across every step that follows. If the two ever need to diverge —
 * a cheap executor with a stronger planner, say — this is where.
 */
export const PLANNER_MODEL = process.env.GROQ_PLANNER_MODEL ?? AGENT_MODEL
