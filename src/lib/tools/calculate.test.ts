import { describe, it, expect } from 'vitest'
import { calculate } from './calculate'

describe('calculate', () => {
  it('handles basic arithmetic with correct precedence', () => {
    expect(calculate('2 + 3 * 4')).toBe(14)
    expect(calculate('(2 + 3) * 4')).toBe(20)
    expect(calculate('10 - 4 - 3')).toBe(3)
  })

  it('handles division and rejects division by zero', () => {
    expect(calculate('10 / 4')).toBe(2.5)
    expect(() => calculate('1 / 0')).toThrow(/division by zero/i)
  })

  it('treats exponentiation as right-associative, like standard notation', () => {
    expect(calculate('2 ^ 3 ^ 2')).toBe(512) // 2^(3^2), not (2^3)^2 = 64
  })

  it('handles unary minus', () => {
    expect(calculate('-5 + 3')).toBe(-2)
    expect(calculate('10 * -2')).toBe(-20)
  })

  it('supports allowlisted functions and constants', () => {
    expect(calculate('sqrt(16)')).toBe(4)
    expect(calculate('round(3.7)')).toBe(4)
    expect(calculate('max(3, 9, 2)')).toBe(9)
    expect(calculate('pi')).toBeCloseTo(Math.PI)
  })

  it('ignores thousands separators, which real figures contain', () => {
    expect(calculate('1,250 * 4')).toBe(5000)
  })

  it('understands percentages the way people write them', () => {
    expect(calculate('20% of 250')).toBe(50)
    expect(calculate('50 + 10%')).toBeCloseTo(50.1)
  })

  it('refuses anything outside the grammar rather than evaluating it', () => {
    // The whole reason this is a parser and not eval(): none of these can
    // reach any runtime capability.
    expect(() => calculate('process.exit(1)')).toThrow()
    expect(() => calculate('require("fs")')).toThrow()
    expect(() => calculate('globalThis')).toThrow()
    expect(() => calculate('1; alert(1)')).toThrow()
    expect(() => calculate('constructor')).toThrow()
  })

  it('rejects unknown functions instead of silently returning something', () => {
    expect(() => calculate('frobnicate(2)')).toThrow(/unknown function/i)
  })

  it('rejects malformed expressions', () => {
    expect(() => calculate('2 +')).toThrow()
    expect(() => calculate('(2 + 3')).toThrow()
    expect(() => calculate('')).toThrow()
  })

  it('rejects an over-long expression rather than parsing unbounded input', () => {
    expect(() => calculate('1+'.repeat(400) + '1')).toThrow(/too long/i)
  })

  it('rejects results that are not finite', () => {
    expect(() => calculate('1e308 * 10')).toThrow(/finite/i)
  })
})
