'use client'

// Spoken replies on iOS.
//
// iOS Safari refuses to play audio that was not started by a user gesture.
// A spoken reply arrives after the model responds, which is never inside
// one, so `new Audio(url).play()` rejects and the reply is silent — on
// iPhone only, which is why it looked like a language problem rather than a
// platform one.
//
// The way round it is that the restriction attaches to the *element*, not to
// each play() call: an element that has once been played during a genuine
// gesture stays playable afterwards. So a single element is created up
// front, unlocked on the user's first interaction with the page, and then
// reused for every reply by swapping its `src`.

// A 44-byte silent WAV. Playing this is inaudible but is enough to mark the
// element as user-initiated.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

let element: HTMLAudioElement | null = null
let unlocked = false

/**
 * The single shared audio element used for every spoken reply.
 *
 * Deliberately one element reused rather than one per reply — a fresh
 * element would be locked again on iOS every time.
 */
export function getPlaybackElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!element) {
    element = new Audio()
    element.preload = 'auto'
  }
  return element
}

export function isAudioUnlocked(): boolean {
  return unlocked
}

/**
 * Mark the shared element as user-initiated. Safe to call repeatedly and on
 * platforms that need none of this; does nothing after the first success.
 */
export function unlockAudioPlayback(): void {
  if (unlocked) return

  const audio = getPlaybackElement()
  if (!audio) return

  try {
    audio.src = SILENT_WAV
    const played = audio.play()

    // Older browsers return undefined rather than a promise.
    if (played === undefined) {
      unlocked = true
      return
    }

    void played
      .then(() => {
        audio.pause()
        audio.currentTime = 0
        unlocked = true
      })
      .catch(() => {
        // Gesture was not accepted (or this browser wanted something
        // different). Leaving `unlocked` false means the next interaction
        // tries again, which costs nothing.
      })
  } catch {
    // Never let unlocking break the interaction that triggered it.
  }
}

/**
 * Unlock on the user's first interaction anywhere on the page.
 *
 * Listens for the events iOS actually counts as gestures, in the capture
 * phase so a handler that stops propagation cannot prevent it. Returns a
 * cleanup function.
 */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {}

  const events: (keyof WindowEventMap)[] = ['pointerdown', 'touchend', 'keydown']

  const handler = (): void => {
    unlockAudioPlayback()
    if (unlocked) remove()
  }

  const remove = (): void => {
    for (const name of events) window.removeEventListener(name, handler, true)
  }

  for (const name of events) window.addEventListener(name, handler, true)

  return remove
}
