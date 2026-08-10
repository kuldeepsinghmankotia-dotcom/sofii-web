'use client'

import { useCallback, useRef } from 'react'
import { haptic } from './haptics'

/**
 * How long a press must last to count as a hold rather than a tap.
 *
 * 250ms is the usual floor for "deliberate": below it a press is
 * indistinguishable from a tap.
 */
export const HOLD_THRESHOLD_MS = 250

/**
 * Whether this pointer gets hold-to-talk behaviour.
 *
 * Touch and pen only. A mouse keeps plain click-to-toggle: people hold a
 * mouse button down briefly without meaning anything by it.
 */
export function usesHoldGesture(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen'
}

/** What a release means, given how long the press lasted. */
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
  /**
   * Begin recording. Called synchronously from the pointerdown handler —
   * see the note in onPointerDown about why that timing is mandatory.
   */
  onPressStart: () => void
  /** Stop recording and send. Called when a hold is released. */
  onStop: () => void
  /** Click-to-toggle, for mice. */
  onTap: () => void
  /** Whether a recording is already in progress. */
  isRecording: boolean
  disabled?: boolean
}

/**
 * Press-and-hold to record, release to send — the WhatsApp voice-note
 * gesture, layered over the existing tap-to-toggle rather than replacing it.
 *
 * Behaviour on touch:
 *   - press when idle          -> starts recording immediately
 *   - release after >= 250ms   -> stops and sends (a hold)
 *   - release before 250ms     -> recording continues (a tap toggled it on)
 *   - press while recording    -> stops on release (a tap toggled it off)
 *
 * Tap therefore still toggles, and hold still sends, from the same button.
 */
export function useHoldToTalk({
  onPressStart,
  onStop,
  onTap,
  isRecording,
  disabled = false
}: UseHoldToTalkOptions): HoldToTalkHandlers {
  const pressedAtRef = useRef<number | null>(null)
  const wasRecordingAtPressRef = useRef(false)
  const suppressClickRef = useRef(false)

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled || !usesHoldGesture(event.pointerType)) return

      pressedAtRef.current = Date.now()
      wasRecordingAtPressRef.current = isRecording
      // Touch fires a click after pointerup; this press already owns the
      // interaction.
      suppressClickRef.current = true

      if (isRecording) return

      // Recording MUST start here, synchronously inside the pointerdown
      // handler, and never from a timer.
      //
      // Safari only permits getUserMedia while a user gesture is still
      // active, and that activation does not survive a setTimeout. An
      // earlier version armed recording from a 250ms hold timer, which
      // Safari silently refused: no permission prompt, no recording, nothing
      // at all on iPhone. Chrome is lenient about this, so it looked fine
      // everywhere else.
      //
      // Starting on press rather than on threshold also just feels better —
      // the mic is live from the instant the finger lands, so the beginning
      // of the sentence is not clipped.
      haptic('tick')
      onPressStart()
    },
    [disabled, isRecording, onPressStart]
  )

  const finishPress = useCallback(
    (event: React.PointerEvent) => {
      if (disabled || !usesHoldGesture(event.pointerType)) return

      const pressedAt = pressedAtRef.current
      pressedAtRef.current = null
      if (pressedAt === null) return

      const wasRecording = wasRecordingAtPressRef.current
      wasRecordingAtPressRef.current = false

      // Pressed while already recording: this is a tap to stop.
      if (wasRecording) {
        haptic('confirm')
        onStop()
        return
      }

      // Released after a real hold: stop and send.
      if (classifyRelease(Date.now() - pressedAt) === 'hold') {
        haptic('confirm')
        onStop()
        return
      }

      // A quick tap started the recording and leaves it running, so the user
      // can talk hands-free and tap again to stop.
    },
    [disabled, onStop]
  )

  const onPointerUp = useCallback((event: React.PointerEvent) => finishPress(event), [finishPress])

  // A cancelled gesture (finger dragged off, call interrupts) must not leave
  // the microphone open.
  const onPointerCancel = useCallback((event: React.PointerEvent) => finishPress(event), [finishPress])

  const onClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (disabled) return
    onTap()
  }, [disabled, onTap])

  return { onPointerDown, onPointerUp, onPointerCancel, onClick }
}
