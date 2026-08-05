// Minimal ambient types for the (non-standard, Chrome/Edge-only) Web Speech
// API's SpeechRecognition — not part of TypeScript's DOM lib. Only the
// members this app actually uses are declared.
interface SpeechRecognitionResult {
  readonly [index: number]: { transcript: string }
}

interface SpeechRecognitionEvent {
  readonly results: ArrayLike<SpeechRecognitionResult>
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: unknown) => void) | null
}

interface Window {
  SpeechRecognition?: new () => SpeechRecognition
  webkitSpeechRecognition?: new () => SpeechRecognition
}
