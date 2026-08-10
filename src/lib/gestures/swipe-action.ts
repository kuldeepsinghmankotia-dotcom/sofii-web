'use client'

import { useCallback, useRef, useState } from 'react'
import { haptic } from './haptics'

/** How far left the row must travel before the action arms. */
export const SWIPE_ARM_THRESHOLD_PX = 72

/** Furthest the row will travel, so it never slides fully off screen. */
export const SWIPE_MAX_OFFSET_PX = 96

/**
 * How much more horizontal than vertical a drag must be to count as a
 * swipe rather than a scroll.
 *
 * A sidebar of conversations is a vertical scroller, so the default has to
 * be scrolling: a finger moving mostly downward must never drag a row
 * sideways, or the list becomes impossible to scroll on a phone. 1.5 is
 * deliberately conservative in favour of scrolling.
 */
const HORIZONTAL_DOMINANCE = 1.5

export type SwipeIntent = 'undecided' | 'horizontal' | 'vertical'

/**
 * Decide what a drag is doing, once it has moved far enough to tell.
 *
 * Below the slop radius the answer is 'undecided' — committing to a
 * direction from the first pixel makes both scrolling and swiping feel like
 * they fight the user.
 */
export function classifyDrag(dx: number, dy: number, slop = 8): SwipeIntent {
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)

  if (absX < slop && absY < slop) return 'undecided'
  return absX > absY * HORIZONTAL_DOMINANCE ? 'horizontal' : 'vertical'
}

/**
 * Clamp a raw drag into the visual offset for the row.
 *
 * Leftward only (negative), because the action sits on the right. Rightward
 * drags return 0 rather than a positive offset, so the row cannot be pulled
 * away from its own affordance.
 */
export function swipeOffset(dx: number, max = SWIPE_MAX_OFFSET_PX): number {
  if (dx >= 0) return 0
  return Math.max(dx, -max)
}

export function isArmed(offset: number, threshold = SWIPE_ARM_THRESHOLD_PX): boolean {
  return offset <= -threshold
}

export interface SwipeActionState {
  offset: number
  armed: boolean
  handlers: {
    onPointerDown: (event: React.PointerEvent) => void
    onPointerMove: (event: React.PointerEvent) => void
    onPointerUp: (event: React.PointerEvent) => void
    onPointerCancel: (event: React.PointerEvent) => void
  }
}

export interface UseSwipeActionOptions {
  /** Fired on release once the swipe passed the arm threshold. */
  onTrigger: () => void
  disabled?: boolean
}

/**
 * Swipe a row leftwards to reveal and fire a single action.
 *
 * Touch and pen only — a mouse has the existing hover menu, and hijacking
 * click-drag on desktop would break text selection for no benefit.
 */
export function useSwipeAction({ onTrigger, disabled = false }: UseSwipeActionOptions): SwipeActionState {
  const [offset, setOffset] = useState(0)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const intentRef = useRef<SwipeIntent>('undecided')
  const armedRef = useRef(false)

  const reset = useCallback(() => {
    startRef.current = null
    intentRef.current = 'undecided'
    armedRef.current = false
    setOffset(0)
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return
      startRef.current = { x: event.clientX, y: event.clientY }
      intentRef.current = 'undecided'
      armedRef.current = false
    },
    [disabled]
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = startRef.current
      if (!start) return

      const dx = event.clientX - start.x
      const dy = event.clientY - start.y

      if (intentRef.current === 'undecided') {
        intentRef.current = classifyDrag(dx, dy)
        // Still ambiguous, or the user is scrolling — leave the list alone.
        if (intentRef.current !== 'horizontal') return
      }

      if (intentRef.current !== 'horizontal') return

      const next = swipeOffset(dx)
      setOffset(next)

      // Buzz exactly once, on the transition into the armed state, so the
      // user knows releasing now will do something — their finger is
      // covering the row.
      const nowArmed = isArmed(next)
      if (nowArmed && !armedRef.current) haptic('warn')
      armedRef.current = nowArmed
    },
    []
  )

  const onPointerUp = useCallback(() => {
    if (!startRef.current) return
    const shouldTrigger = armedRef.current
    reset()
    if (shouldTrigger) onTrigger()
  }, [onTrigger, reset])

  const onPointerCancel = useCallback(() => reset(), [reset])

  return {
    offset,
    armed: isArmed(offset),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
  }
}
