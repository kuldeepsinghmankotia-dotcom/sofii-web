import { describe, it, expect } from 'vitest'
import { buildPriorContext, type StepRow } from './executor'

const step = (i: number, result: string | null, title = `Step ${i}`): StepRow => ({
  id: String(i),
  step_index: i,
  title,
  status: result ? 'done' : 'pending',
  result
})

describe('buildPriorContext', () => {
  it('includes only completed steps that came before this one', () => {
    const steps = [step(0, 'first result'), step(1, null), step(2, 'later result')]
    const ctx = buildPriorContext(steps, 1)
    expect(ctx).toContain('first result')
    // A step that has not run has nothing to say, and including its title
    // would read as though it had.
    expect(ctx).not.toContain('later result')
  })

  it('reads in chronological order', () => {
    const steps = [step(0, 'alpha'), step(1, 'beta')]
    const ctx = buildPriorContext(steps, 2)
    expect(ctx.indexOf('alpha')).toBeLessThan(ctx.indexOf('beta'))
  })

  it('trims an oversized result rather than carrying it whole', () => {
    // Unbounded context grew quadratically: by step five, four full research
    // outputs travelled with every request, which is both slow and the
    // fastest way to exhaust a per-minute token budget.
    const huge = 'x'.repeat(50_000)
    const ctx = buildPriorContext([step(0, huge)], 1)
    expect(ctx.length).toBeLessThan(2000)
    expect(ctx).toContain('trimmed')
  })

  it('caps total context across many steps', () => {
    const steps = Array.from({ length: 12 }, (_, i) => step(i, 'y'.repeat(3000)))
    const ctx = buildPriorContext(steps, 12)
    expect(ctx.length).toBeLessThan(8000)
  })

  it('says when older steps were dropped, rather than hiding it', () => {
    // The model must not mistake a truncated history for the whole of it.
    const steps = Array.from({ length: 12 }, (_, i) => step(i, 'z'.repeat(3000)))
    expect(buildPriorContext(steps, 12)).toMatch(/omitted/i)
  })

  it('keeps the most recent work when the budget is tight', () => {
    // A step almost always builds on what immediately preceded it.
    const steps = [
      step(0, 'a'.repeat(5000), 'oldest'),
      step(1, 'b'.repeat(5000), 'newest')
    ]
    const ctx = buildPriorContext(steps, 2)
    expect(ctx).toContain('newest')
  })

  it('returns empty for the first step', () => {
    expect(buildPriorContext([step(0, null)], 0)).toBe('')
  })
})
