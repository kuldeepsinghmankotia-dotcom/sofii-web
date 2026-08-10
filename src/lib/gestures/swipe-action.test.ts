import { describe, it, expect } from 'vitest'
import {
  classifyDrag,
  swipeOffset,
  isArmed,
  SWIPE_ARM_THRESHOLD_PX,
  SWIPE_MAX_OFFSET_PX
} from './swipe-action'

describe('classifyDrag', () => {
  it('stays undecided inside the slop radius', () => {
    // Committing to a direction from the first pixel makes both scrolling
    // and swiping feel like they fight the user.
    expect(classifyDrag(0, 0)).toBe('undecided')
    expect(classifyDrag(5, 3)).toBe('undecided')
  })

  it('reads a clearly sideways drag as horizontal', () => {
    expect(classifyDrag(-40, 2)).toBe('horizontal')
    expect(classifyDrag(-100, 20)).toBe('horizontal')
  })

  it('reads a mostly vertical drag as a scroll', () => {
    expect(classifyDrag(4, -60)).toBe('vertical')
    expect(classifyDrag(-20, 80)).toBe('vertical')
  })

  it('favours scrolling when the two are close', () => {
    // The sidebar is a vertical list first. A diagonal drag must scroll,
    // not swipe, or the list becomes hard to scroll on a phone.
    expect(classifyDrag(-30, 25)).toBe('vertical')
    expect(classifyDrag(-30, -25)).toBe('vertical')
  })
})

describe('swipeOffset', () => {
  it('follows a leftward drag', () => {
    expect(swipeOffset(-40)).toBe(-40)
  })

  it('clamps so the row never slides fully off screen', () => {
    expect(swipeOffset(-500)).toBe(-SWIPE_MAX_OFFSET_PX)
  })

  it('ignores rightward drags', () => {
    // The action sits on the right; letting the row be pulled the other way
    // would drag it away from its own affordance.
    expect(swipeOffset(60)).toBe(0)
    expect(swipeOffset(0)).toBe(0)
  })
})

describe('isArmed', () => {
  it('arms only past the threshold', () => {
    expect(isArmed(-SWIPE_ARM_THRESHOLD_PX)).toBe(true)
    expect(isArmed(-SWIPE_ARM_THRESHOLD_PX - 1)).toBe(true)
    expect(isArmed(-SWIPE_ARM_THRESHOLD_PX + 1)).toBe(false)
  })

  it('is never armed at rest', () => {
    expect(isArmed(0)).toBe(false)
  })

  it('arms within the maximum offset, so the gesture is always reachable', () => {
    // If the clamp were tighter than the threshold the row could never arm
    // at all and the gesture would be dead.
    expect(SWIPE_MAX_OFFSET_PX).toBeGreaterThan(SWIPE_ARM_THRESHOLD_PX)
    expect(isArmed(swipeOffset(-1000))).toBe(true)
  })
})
