// Short vibrations that confirm a gesture actually registered.
//
// Gestures have no hover state and no cursor — without feedback the user
// cannot tell a long-press that fired from one that did not, and ends up
// pressing again. A 10ms tick answers that question far faster than any
// visual change can.
//
// Deliberately tiny durations: anything longer reads as an alert rather
// than an acknowledgement, and iOS Safari ignores navigator.vibrate
// entirely, so this must never be the only feedback a gesture gives.

type HapticPattern = 'tick' | 'confirm' | 'warn'

const PATTERNS: Record<HapticPattern, number | number[]> = {
  // A gesture crossed its threshold and is now active (hold-to-talk armed,
  // long-press fired).
  tick: 10,
  // A gesture completed and did something (message sent, memory saved).
  confirm: [10, 40, 10],
  // A destructive gesture is armed (swipe far enough to delete).
  warn: 25
}

export function haptic(pattern: HapticPattern = 'tick'): void {
  // navigator.vibrate is absent on desktop Safari/Firefox and ignored on
  // iOS; guarding rather than try/catching keeps this silent there.
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return

  try {
    navigator.vibrate(PATTERNS[pattern])
  } catch {
    // Some browsers throw if the page has never been interacted with.
    // A missing buzz is never worth surfacing.
  }
}
