import { describe, it, expect } from 'vitest'
import { parsePlan, MAX_STEPS, MIN_STEPS } from './planner'

describe('parsePlan', () => {
  it('accepts a well-formed plan', () => {
    const plan = parsePlan(
      JSON.stringify({
        worth_planning: true,
        steps: [{ title: 'Search for suppliers' }, { title: 'Compare their pricing' }]
      })
    )
    expect(plan.worthPlanning).toBe(true)
    expect(plan.steps.map((s) => s.title)).toEqual(['Search for suppliers', 'Compare their pricing'])
  })

  it('honours an explicit decision not to plan', () => {
    const plan = parsePlan(
      JSON.stringify({ worth_planning: false, reason: 'This is a single factual question.' })
    )
    expect(plan.worthPlanning).toBe(false)
    expect(plan.reason).toBe('This is a single factual question.')
  })

  it('declines a plan too short to be worth the ceremony', () => {
    // A one-step "plan" is just an answer with extra latency and a progress
    // bar in front of it.
    const plan = parsePlan(JSON.stringify({ worth_planning: true, steps: [{ title: 'Answer' }] }))
    expect(plan.worthPlanning).toBe(false)
  })

  it('caps an over-long plan instead of rejecting it', () => {
    // Dropping the tail keeps a coherent plan; rejecting outright would lose
    // work the user actually asked for.
    const steps = Array.from({ length: 25 }, (_, i) => ({ title: `Step ${i}` }))
    const plan = parsePlan(JSON.stringify({ worth_planning: true, steps }))
    expect(plan.worthPlanning).toBe(true)
    expect(plan.steps).toHaveLength(MAX_STEPS)
  })

  it('skips malformed entries but keeps the usable ones', () => {
    const plan = parsePlan(
      JSON.stringify({
        worth_planning: true,
        steps: [{ title: 'Good one' }, null, { title: '' }, { notTitle: 'x' }, { title: 'Another' }]
      })
    )
    expect(plan.steps.map((s) => s.title)).toEqual(['Good one', 'Another'])
  })

  it('truncates an over-long title rather than dropping the step', () => {
    const plan = parsePlan(
      JSON.stringify({
        worth_planning: true,
        steps: [{ title: 'x'.repeat(500) }, { title: 'Second' }]
      })
    )
    expect(plan.steps[0].title).toHaveLength(200)
    expect(plan.steps).toHaveLength(2)
  })

  it('refuses anything that is not valid JSON', () => {
    // A model that cannot return JSON is not one to hand a task list to.
    expect(parsePlan('not json at all').worthPlanning).toBe(false)
    expect(parsePlan('').worthPlanning).toBe(false)
    expect(parsePlan('null').worthPlanning).toBe(false)
    expect(parsePlan('[]').worthPlanning).toBe(false)
  })

  it('refuses a response with no steps array', () => {
    expect(parsePlan(JSON.stringify({ worth_planning: true })).worthPlanning).toBe(false)
    expect(parsePlan(JSON.stringify({ worth_planning: true, steps: 'nope' })).worthPlanning).toBe(false)
  })

  it('never returns steps when it declines to plan', () => {
    // Callers branch on worthPlanning; leaving steps populated alongside a
    // refusal invites executing a plan that was rejected.
    const declined = parsePlan(JSON.stringify({ worth_planning: false, reason: 'no' }))
    expect(declined.steps).toEqual([])
  })

  it('keeps MIN_STEPS below MAX_STEPS, so some plan is always possible', () => {
    expect(MIN_STEPS).toBeLessThan(MAX_STEPS)
  })
})
