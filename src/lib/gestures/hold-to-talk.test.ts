import { describe, it, expect } from 'vitest'
import { classifyRelease, usesHoldGesture, HOLD_THRESHOLD_MS } from './hold-to-talk'

describe('usesHoldGesture', () => {
  it('applies to touch and pen', () => {
    expect(usesHoldGesture('touch')).toBe(true)
    expect(usesHoldGesture('pen')).toBe(true)
  })

  it('does not apply to a mouse', () => {
    // Holding a mouse button down briefly is something people do without
    // meaning anything by it. Treating that as a recording would start and
    // immediately stop the mic, a regression on desktop where the existing
    // tap-to-toggle already works.
    expect(usesHoldGesture('mouse')).toBe(false)
  })

  it('does not apply to an unknown pointer type', () => {
    // Some browsers report an empty string. Defaulting to the plain click
    // path is the safe direction: worst case the user loses a gesture,
    // rather than gaining one that misfires.
    expect(usesHoldGesture('')).toBe(false)
  })
})

describe('classifyRelease', () => {
  it('treats a quick release as a tap', () => {
    expect(classifyRelease(0)).toBe('tap')
    expect(classifyRelease(120)).toBe('tap')
  })

  it('treats a sustained press as a hold', () => {
    expect(classifyRelease(400)).toBe('hold')
    expect(classifyRelease(3000)).toBe('hold')
  })

  it('counts exactly the threshold as a hold, not a tap', () => {
    // The timer that starts recording fires at >= the threshold, so the
    // release rule has to agree with it exactly — otherwise a press landing
    // on the boundary starts the mic and is then classified as a tap,
    // toggling it straight back off.
    expect(classifyRelease(HOLD_THRESHOLD_MS)).toBe('hold')
    expect(classifyRelease(HOLD_THRESHOLD_MS - 1)).toBe('tap')
  })

  it('honours a custom threshold', () => {
    expect(classifyRelease(300, 500)).toBe('tap')
    expect(classifyRelease(600, 500)).toBe('hold')
  })
})
