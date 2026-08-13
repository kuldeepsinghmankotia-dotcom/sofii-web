import { describe, it, expect } from 'vitest'
import { describeSupabaseError } from './describe-error'

describe('describeSupabaseError', () => {
  it('renders a PostgrestError instead of the empty braces console gives', () => {
    // The real one, taken from the dev log. console.error printed this as
    // `⨯ {}` — 307 times, while the reminder poller failed every 30 seconds
    // and nobody could see why.
    const real = {
      code: 'PGRST303',
      details: null,
      hint: null,
      message: 'JWT issued at future'
    }
    const out = describeSupabaseError(real)
    expect(out).toContain('PGRST303')
    expect(out).toContain('JWT issued at future')
    expect(out).not.toBe('{}')
  })

  it('includes details and hint when the database supplies them', () => {
    const out = describeSupabaseError({
      code: '42501',
      message: 'permission denied',
      details: 'for table memories',
      hint: 'grant select'
    })
    expect(out).toContain('42501')
    expect(out).toContain('for table memories')
    expect(out).toContain('grant select')
  })

  it('prefers a real Error message', () => {
    expect(describeSupabaseError(new Error('network unreachable'))).toBe('network unreachable')
  })

  it('passes a plain string through', () => {
    expect(describeSupabaseError('something went wrong')).toBe('something went wrong')
  })

  it('never returns empty braces, whatever it is handed', () => {
    // The entire point: a log line that proves something failed and says
    // nothing about what is worse than no log line at all.
    for (const input of [{}, [], 0, false, null, undefined, Symbol('x')]) {
      const out = describeSupabaseError(input)
      expect(out).not.toBe('{}')
      expect(out.length).toBeGreaterThan(0)
    }
  })

  it('survives an object that cannot be serialised', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => describeSupabaseError(circular)).not.toThrow()
    expect(describeSupabaseError(circular)).toContain('unserialisable')
  })
})
