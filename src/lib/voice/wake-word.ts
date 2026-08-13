// Deciding whether the user actually said "Sofii".
//
// Extracted from chat-window so the rule is testable on its own — it is the
// difference between an assistant that listens when asked and one that opens
// the microphone by itself, which is the single most invasive thing this app
// can get wrong.

/**
 * "Sofii" is uncommon enough that generic speech models mishear it, so close
 * variants count. Preferring false negatives over false positives is the
 * right trade here: not triggering is a minor annoyance, triggering unbidden
 * is the app listening to a room without being asked.
 */
export const WAKE_PHRASES = ['sofii', 'sofi', 'sophie', 'sophia', 'sofia']

/**
 * Whole words only.
 *
 * A substring test — the original implementation — fires on any word
 * containing the letters, and with speech being transcribed continuously
 * that happens far more often than it sounds like it would.
 */
const WAKE_PATTERN = new RegExp(`\\b(${WAKE_PHRASES.join('|')})\\b`, 'i')

export function containsWakeWord(transcript: string): boolean {
  return WAKE_PATTERN.test(transcript)
}

/**
 * The portion of a recognition event that is new.
 *
 * SpeechRecognitionEvent.results is cumulative in continuous mode: it carries
 * every result since the session began. Reading all of it meant one
 * mishearing kept matching on every later event for the rest of the session,
 * reopening the microphone repeatedly with nobody having spoken.
 * `resultIndex` marks where this event's new results start.
 */
// Structural, not tied to the ambient SpeechRecognition types, so this stays
// testable with plain objects. The index signature mirrors how the Web Speech
// API actually exposes alternatives.
interface TranscriptResult {
  readonly [index: number]: { transcript: string }
}

export function newTranscript(event: {
  results: ArrayLike<TranscriptResult>
  resultIndex?: number
}): string {
  return Array.from(event.results)
    .slice(event.resultIndex ?? 0)
    .map((r) => r[0].transcript)
    .join(' ')
}
