'use client'

import { useCallback, useRef } from 'react'
import { haptic } from './haptics'

/**
 * How long a press must last before it counts as a hold rather than a tap.
 *
 * 250ms is the usual floor for "deliberate": below it, the press is
 * indistinguishable from a tap and users who meant to toggle end up
 * recording a fraction of a second of silence.
 */
export const HOLD_THRESHOLD_MS = 250

/**
 * Whether this pointer should get hold-to-talk behaviour at all.
 *
 * Touch and pen only. A mouse gets plain click-to-toggle: holding a mouse
 * button down for a moment before releasing is something people do without
 * meaning anything by it, and turning that into a recording that starts and
 * immediately stops would be a regression on desktop, where the existing
 * toggle works fine.
 */
export function usesHoldGesture(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen'
}

/**
 * What a release means, given how long the press lasted.
 *
 * Separated from the hook so the timing rule is testable without a DOM:
 * it is the whole behaviour, and getting it wrong is the difference
 * between "hold to talk" and "tap does nothing".
 */
export function classifyRelease(heldMs: number, thresholdMs: number = HOLD_THRESHOLD_MS): 'tap' | 'hold' {
  return heldMs >= thresholdMs ? 'hold' : 'tap'
}

export interface HoldToTalkHandlers {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerCancel: (event: React.PointerEvent) => void
  onClick: (event: React.MouseEvent) => void
}

export interface UseHoldToTalkOptions {
  /** Begin recording. Called once the hold threshold is crossed. */
  onHoldStart: () => void
  /** Finish recording and send. Called on release after a hold. */
  onHoldEnd: () => void
  /** The existing tap behaviour (toggle recording on/off). */
  onTap: () => void
  disabled?: boolean
}

/**
 * WhatsApp-style press-and-hold to record, release to send — layered on top
 * of the existing tap-to-toggle rather than replacing it.
 *
 * Both gestures remain available deliberately: hold is what Indian users
 * already expect from voice notes, but tap-to-toggle is what works with a
 * keyboard, a mouse, and assistive technology, and is the only one usable
 * for a long dictation where holding a finger down for a minute is not
 * reasonable.
 */
export function useHoldToTalk({
  onHoldStart,
  onHoldEnd,
  onTap,
  disabled = false
}: UseHoldToTalkOptions): HoldToTalkHandlers {
  const pressedAtRef = useRef<number | null>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isHoldingRef = useRef(false)
  // Set when a hold consumed the interaction, so the click event the browser
  // still fires afterwards does not also toggle recording back on.
  const suppressClickRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled || !usesHoldGesture(event.pointerType)) return

      pressedAtRef.current = Date.now()
      isHoldingRef.current = false

      clearTimer()
      holdTimerRef.current = setTimeout(() => {
        isHoldingRef.current = true
        // Confirms the mic is now live, which matters because the user's own
        // finger is covering the button.
        haptic('tick')
        onHoldStart()
      }, HOLD_THRESHOLD_MS)
    },
    [disabled, clearTimer, onHoldStart]
  )

  const finishPress = useCallback(
    (event: React.PointerEvent, cancelled: boolean) => {
      if (disabled || !usesHoldGesture(event.pointerType)) return

      clearTimer()

      const pressedAt = pressedAtRef.current
      pressedAtRef.current = null

      if (pressedAt === null) return

      const wasHolding = isHoldingRef.current
      isHoldingRef.current = false

      if (wasHolding) {
        // The hold already started recording, so this release owns the
        // interaction entirely — the click that follows must not toggle.
        suppressClickRef.current = true
        haptic('confirm')
        onHoldEnd()
        return
      }

      // Released before the threshold. A genuine cancel (pointer left the
      // element, gesture interrupted) should do nothing at all; a normal
      // release is a tap, which the click handler below will action.
      if (cancelled) suppressClickRef.current = true
      void classifyRelease(Date.now() - pressedAt)
    },
    [disabled, clearTimer, onHoldEnd]
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => finishPress(event, false),
    [finishPress]
  )

  const onPointerCancel = useCallback(
    (event: React.PointerEvent) => finishPress(event, true),
    [finishPress]
  )

  const onClick = useCallback(() => {
    // Touch produces a click after pointerup; a hold has already handled the
    // interaction and must swallow exactly one.
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (disabled) return
    onTap()
  }, [disabled, onTap])

  return { onPointerDown, onPointerUp, onPointerCancel, onClick }
}
