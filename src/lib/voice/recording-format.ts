// Which container the browser can actually record into.
//
// This app hardcoded 'audio/webm;codecs=opus'. Chrome and Firefox record
// WebM happily; Safari cannot record it at all, on any platform. Passing a
// mimeType MediaRecorder does not support makes the *constructor throw*, so
// on an iPhone voice input never started — no permission prompt, no
// recording, nothing. Not a hold-to-talk bug: tapping was equally dead.
//
// Safari records MP4/AAC instead. Both Whisper (via Groq) and Sarvam's
// Saaras accept mp4/m4a, so nothing downstream needs to change — the only
// requirement is that the blob and the upload's Content-Type honestly
// describe what was recorded, rather than claiming webm regardless.

/** Preferred first, most-compatible last. */
const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus', // Chrome, Firefox, Edge — best quality per byte
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2', // Safari (iOS and macOS)
  'audio/mp4',
  'audio/aac',
  'audio/ogg;codecs=opus'
]

/**
 * The best container this browser can record, or null to let the browser
 * choose its own default.
 *
 * Null is meaningful rather than a failure: MediaRecorder picks a supported
 * type when constructed without one, which is strictly safer than forcing a
 * guess. Older Safari also lacks isTypeSupported entirely, and must take
 * that path.
 */
export function pickRecordingMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  if (typeof MediaRecorder.isTypeSupported !== 'function') return null

  return CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

/**
 * Normalise a recorder's mimeType into something usable as a request
 * Content-Type and a filename extension.
 *
 * MediaRecorder reports the full codec string ('audio/webm;codecs=opus');
 * the parameters confuse some upload endpoints, so the base type is used.
 */
export function baseMimeType(mimeType: string | undefined | null, fallback = 'audio/webm'): string {
  if (!mimeType) return fallback
  const base = mimeType.split(';')[0].trim()
  return base || fallback
}

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3'
}

/** Filename extension matching a mime type — speech APIs route on it. */
export function extensionForMimeType(mimeType: string | undefined | null): string {
  return EXTENSIONS[baseMimeType(mimeType)] ?? 'webm'
}
