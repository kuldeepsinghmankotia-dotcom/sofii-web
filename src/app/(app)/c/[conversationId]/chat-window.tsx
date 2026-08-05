'use client'

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resizeImageToJpeg } from '@/lib/image/resize'
import VoiceOrb from './voice-orb'
import type { ChatMessage } from '@/lib/db/messages'

type Props = {
  conversationId: string
  initialMessages: ChatMessage[]
}

// Checked as a plain substring match against the browser's own speech
// recognition transcript — "Sofii" is an uncommon name that generic speech
// models often mishear, so a few likely-sounding variants are included
// rather than requiring an exact match. This is a real accuracy trade-off,
// not a bug: false negatives (said it, didn't trigger) are more likely than
// false positives at this stage.
const WAKE_PHRASES = ['sofii', 'sofi', 'sophie', 'sophia', 'sofia']

function containsWakeWord(transcript: string): boolean {
  const lower = transcript.toLowerCase()
  return WAKE_PHRASES.some((phrase) => lower.includes(phrase))
}

const SPEECH_RMS_THRESHOLD = 0.02
const SILENCE_TO_STOP_MS = 1200
const MAX_WAIT_FOR_SPEECH_MS = 6000

/**
 * Lightweight energy-based voice-activity detection: watches live mic
 * amplitude and calls back once the user has spoken and then gone quiet for
 * SILENCE_TO_STOP_MS, or gives up after MAX_WAIT_FOR_SPEECH_MS of hearing
 * nothing at all. This is what lets hands-free mode work without a Stop
 * button — manual push-to-talk recording doesn't use this at all, so its
 * existing explicit-Stop behavior is unchanged.
 */
function attachSilenceAutoStop(
  stream: MediaStream,
  onSilence: (heardSpeech: boolean) => void
): () => void {
  const audioCtx = new AudioContext()
  const source = audioCtx.createMediaStreamSource(stream)
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 256
  source.connect(analyser)
  const data = new Uint8Array(analyser.frequencyBinCount)

  let hasSpoken = false
  let silenceStartedAt: number | null = null
  const startedAt = Date.now()
  let raf = 0
  let stopped = false

  const cleanup = (): void => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf)
    source.disconnect()
    void audioCtx.close()
  }

  const tick = (): void => {
    raf = requestAnimationFrame(tick)

    analyser.getByteTimeDomainData(data)
    let sumSquares = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sumSquares += v * v
    }
    const rms = Math.sqrt(sumSquares / data.length)

    if (rms > SPEECH_RMS_THRESHOLD) {
      hasSpoken = true
      silenceStartedAt = null
      return
    }

    if (hasSpoken) {
      if (silenceStartedAt === null) silenceStartedAt = Date.now()
      else if (Date.now() - silenceStartedAt > SILENCE_TO_STOP_MS) {
        cleanup()
        onSilence(true)
      }
    } else if (Date.now() - startedAt > MAX_WAIT_FOR_SPEECH_MS) {
      cleanup()
      onSilence(false)
    }
  }

  tick()
  return cleanup
}

export default function ChatWindow({ conversationId, initialMessages }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [speakEnabled, setSpeakEnabled] = useState(false)
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false)
  const [isWakeListening, setIsWakeListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  // Spans an ENTIRE hands-free turn (wake word heard → recording →
  // transcribing → sending → speaking → maybe another turn), set once at
  // the start and cleared once at the true end — deliberately NOT derived
  // from isRecording/isTranscribing/sending/isSpeaking individually. An
  // earlier version gated the wake-word listener on those four flags
  // directly, which flicker through brief all-false gaps *between* each
  // stage of a single turn; each gap tore down and immediately recreated a
  // new SpeechRecognition instance, and real-world testing showed Chrome's
  // speech engine can get stuck after being cycled like that — it would
  // listen once and then silently never fire another event. This single
  // stable flag only changes twice per turn, so the listener only
  // restarts once too.
  const [voiceTurnActive, setVoiceTurnActive] = useState(false)
  const [pendingImage, setPendingImage] = useState<{
    file: File
    previewUrl: string
  } | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<BlobPart[]>([])
  const imageInputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const vadStopRef = useRef<(() => void) | null>(null)
  const heardSpeechRef = useRef(true)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel()
    }
  }, [])

  // Runs on every messages change, including each streamed chunk (each one
  // is its own setMessages call), so the view keeps following a reply as it
  // streams in rather than only jumping down once at the end.
  useEffect(() => {
    const container = messagesContainerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [messages])

  // Separate effect (rather than folding into the mount-only one above) so
  // the cleanup always sees the current pendingImage rather than a stale
  // closure over whatever it was at mount time.
  useEffect(() => {
    return () => {
      if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
    }
  }, [pendingImage])

  const speak = (text: string, onEnd?: () => void): void => {
    if (!speakEnabled || !text.trim()) {
      onEnd?.()
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    // isSpeaking gates the wake-word listener below (see that effect) so it
    // doesn't arm itself while Sofii's own voice is playing through the
    // speakers — otherwise the mic could pick up her own reply and
    // misinterpret it as containing the wake word.
    setIsSpeaking(true)
    utterance.onend = () => {
      setIsSpeaking(false)
      onEnd?.()
    }
    window.speechSynthesis.speak(utterance)
  }

  const addSystemNote = (content: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        created_at: new Date().toISOString(),
        image_url: null
      }
    ])
  }

  const handleImageSelect = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploadingImage(true)
    try {
      // Resizing (not just re-encoding) matters even for a single message:
      // an unresized full-resolution phone photo alone can exceed Groq's
      // vision-model token budget — verified live in production.
      const resized = await resizeImageToJpeg(file)
      if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
      setPendingImage({
        file: resized,
        previewUrl: URL.createObjectURL(resized)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addSystemNote(message)
    } finally {
      setUploadingImage(false)
    }
  }

  const clearPendingImage = (): void => {
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
    setPendingImage(null)
  }

  const sendMessage = async (overrideContent?: string): Promise<void> => {
    const content = overrideContent ?? input
    if ((!content.trim() && !pendingImage) || sending) return

    if (overrideContent === undefined) setInput('')
    setSending(true)

    let imageUrl: string | undefined
    const imageToUpload = pendingImage
    clearPendingImage()

    if (imageToUpload) {
      setUploadingImage(true)
      try {
        const supabase = createClient()
        const {
          data: { user }
        } = await supabase.auth.getUser()

        if (user) {
          const ext = imageToUpload.file.name.split('.').pop() || 'png'
          const path = `${user.id}/${crypto.randomUUID()}.${ext}`
          const { error } = await supabase.storage
            .from('chat-images')
            .upload(path, imageToUpload.file, {
              contentType: imageToUpload.file.type
            })

          if (error) throw error

          imageUrl = supabase.storage.from('chat-images').getPublicUrl(path).data.publicUrl
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        addSystemNote(`Image upload failed: ${message}`)
        setSending(false)
        setUploadingImage(false)
        return
      }
      setUploadingImage(false)
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      created_at: new Date().toISOString(),
      image_url: imageUrl ?? null
    }

    const assistantId = crypto.randomUUID()
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      image_url: null
    }

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder])

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, content, imageUrl })
    })

    if (!response.ok || !response.body) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: 'Something went wrong.' } : m))
      )
      setSending(false)
      setVoiceTurnActive(false)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      fullContent += chunk
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))
      )
    }

    setSending(false)

    // In hands-free mode, keep the conversation going after the spoken
    // reply finishes — a real Jarvis-style back-and-forth instead of
    // requiring the wake word again for every turn. If the user says
    // nothing, the VAD's own give-up timeout (see attachSilenceAutoStop)
    // drops this back to passive wake-word listening on its own.
    speak(fullContent, () => {
      if (wakeWordEnabled) {
        void startRecording({ autoStopOnSilence: true })
      } else {
        setVoiceTurnActive(false)
      }
    })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') sendMessage()
  }

  const startRecording = async (options?: { autoStopOnSilence?: boolean }): Promise<void> => {
    // Set here (covering every hands-free recording, whatever triggered
    // it — wake word, or an auto-continue after a reply to a typed
    // message while Jarvis mode happens to be on) rather than only where
    // the wake word is detected: that would leave a gap where this
    // specific recording's later transcribing/sending stage isn't covered
    // by voiceTurnActive, letting the wake-word listener incorrectly
    // re-arm mid-turn.
    if (options?.autoStopOnSilence) setVoiceTurnActive(true)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })
      audioChunksRef.current = []
      heardSpeechRef.current = true
      setMicStream(stream)

      recorder.ondataavailable = (e): void => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async (): Promise<void> => {
        vadStopRef.current?.()
        vadStopRef.current = null
        stream.getTracks().forEach((track) => track.stop())
        setMicStream(null)

        // A hands-free session that timed out without anyone saying
        // anything doesn't need a Whisper call at all — this is known
        // client-side already, no need to transcribe silence. The turn is
        // over either way: back to passive wake-word listening.
        if (!heardSpeechRef.current) {
          setVoiceTurnActive(false)
          return
        }

        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })

        setIsTranscribing(true)
        try {
          const response = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'audio/webm' },
            body: blob
          })

          if (!response.ok) throw new Error(await response.text())

          const { text } = (await response.json()) as { text: string }
          if (text.trim()) {
            // sendMessage clears voiceTurnActive itself once the whole
            // reply (including speaking it) is done.
            await sendMessage(text.trim())
          } else {
            setVoiceTurnActive(false)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          addSystemNote(`Transcription failed: ${message}`)
          setVoiceTurnActive(false)
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)

      if (options?.autoStopOnSilence) {
        vadStopRef.current = attachSilenceAutoStop(stream, (heardSpeech) => {
          heardSpeechRef.current = heardSpeech
          if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop()
          }
          setIsRecording(false)
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addSystemNote(`Microphone unavailable: ${message}`)
      setVoiceTurnActive(false)
    }
  }

  const stopRecording = (): void => {
    vadStopRef.current?.()
    vadStopRef.current = null
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }

  const toggleRecording = (): void => {
    if (isRecording) {
      stopRecording()
    } else {
      void startRecording()
    }
  }

  // Continuous "Sofii" wake-word listening. Only armed while nothing else
  // voice-related is already happening. isRecording and voiceTurnActive
  // (rather than the individual isTranscribing/sending flags — see that
  // state's own comment for why) cover a hands-free turn end to end; isSpeaking
  // is still needed on top of those for one edge case they don't cover: a
  // MANUALLY push-to-talk-recorded message while Jarvis mode also happens
  // to be enabled doesn't set voiceTurnActive at all, so without isSpeaking
  // here the listener would re-arm and could pick up Sofii's own spoken
  // reply to that manual message. Re-arms once whichever of these caused
  // the pause finishes. Chrome/Edge only (the Web Speech API isn't
  // implemented elsewhere); this is the free, no-new-account path, at the
  // cost of accuracy some dedicated wake-word engines would do better, and
  // of continuous audio going to the browser's speech service while armed
  // — a real, deliberate trade-off against this app's previous
  // push-to-talk-only design, made explicitly at the user's request.
  useEffect(() => {
    if (!wakeWordEnabled || isRecording || voiceTurnActive || isSpeaking) {
      recognitionRef.current?.stop()
      recognitionRef.current = null
      // Deferred rather than called synchronously in the effect body —
      // this project's react-hooks/set-state-in-effect rule (React
      // Compiler) flags that as cascading-render-prone.
      queueMicrotask(() => setIsWakeListening(false))
      return
    }

    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      queueMicrotask(() => {
        addSystemNote("Wake-word mode needs Chrome or Edge — this browser doesn't support it.")
        setWakeWordEnabled(false)
      })
      return
    }

    let stopped = false

    const arm = (): void => {
      if (stopped) return

      const recognition = new SpeechRecognitionCtor()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'
      let heard = false

      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((r) => r[0].transcript)
          .join(' ')
        if (containsWakeWord(transcript)) {
          heard = true
          recognition.stop()
        }
      }

      recognition.onerror = () => {
        // 'no-speech'/'aborted'/etc. — onend still fires after, handled there.
      }

      recognition.onend = () => {
        if (stopped) return
        if (heard) {
          setIsWakeListening(false)
          // startRecording itself sets voiceTurnActive when
          // autoStopOnSilence is requested — see its own comment.
          void startRecording({ autoStopOnSilence: true })
        } else {
          arm()
        }
      }

      recognition.start()
      recognitionRef.current = recognition
      queueMicrotask(() => setIsWakeListening(true))
    }

    arm()

    return () => {
      stopped = true
      if (recognitionRef.current) {
        recognitionRef.current.onend = null
        recognitionRef.current.stop()
      }
      recognitionRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeWordEnabled, isRecording, voiceTurnActive, isSpeaking])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-end gap-3">
        {isWakeListening && (
          <span className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            Listening for &ldquo;Sofii&rdquo;…
          </span>
        )}
        <button
          onClick={() => {
            setWakeWordEnabled((prev) => {
              const next = !prev
              // Hands-free replies need to be audible — enabling Jarvis
              // mode turns speech on too rather than leaving a silent
              // hands-free loop that only works if the toggle happened to
              // already be on.
              if (next) setSpeakEnabled(true)
              return next
            })
          }}
          title={wakeWordEnabled ? 'Jarvis mode on — say "Sofii" anytime' : 'Enable Jarvis mode'}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            wakeWordEnabled ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-300'
          }`}
        >
          🪄 Jarvis
        </button>
        <button
          onClick={() =>
            setSpeakEnabled((prev) => {
              if (prev) window.speechSynthesis.cancel()
              return !prev
            })
          }
          title={speakEnabled ? 'Spoken replies on' : 'Spoken replies off'}
          className="text-lg"
        >
          {speakEnabled ? '🔊' : '🔇'}
        </button>
      </div>

      <div ref={messagesContainerRef} className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[75%] rounded-xl p-3 whitespace-pre-wrap ${
              m.role === 'user' ? 'ml-auto bg-blue-600' : 'bg-neutral-800'
            }`}
          >
            {m.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.image_url}
                alt="Attached"
                className="mb-2 max-h-64 max-w-full rounded-lg object-contain"
              />
            )}
            {m.content}
          </div>
        ))}
        {isTranscribing && <div className="ml-auto text-sm text-neutral-400">Transcribing…</div>}
      </div>

      {pendingImage && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-neutral-800 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pendingImage.previewUrl}
            alt="To send"
            className="h-12 w-12 rounded object-cover"
          />
          <span className="flex-1 truncate text-sm text-neutral-300">{pendingImage.file.name}</span>
          <button
            onClick={clearPendingImage}
            title="Remove image"
            className="text-neutral-400 hover:text-neutral-200"
          >
            ✕
          </button>
        </div>
      )}

      {isRecording && micStream ? (
        // Fixed, viewport-centered overlay (not just centered within the
        // composer strip) — a full "voice mode" takeover like Gemini
        // Live/Jarvis, not a small inline indicator.
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-black/90 backdrop-blur-sm">
          <VoiceOrb stream={micStream} size={260} />
          <p className="text-sm text-neutral-400">Listening…</p>
          <button
            onClick={stopRecording}
            title="Stop recording"
            className="rounded-full bg-red-600 px-8 py-3 font-medium"
          >
            Stop
          </button>
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            onClick={toggleRecording}
            disabled={isTranscribing}
            title="Start recording"
            className="rounded-lg bg-neutral-800 px-4 py-3 font-medium disabled:opacity-60"
          >
            🎙️
          </button>
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={uploadingImage}
            title="Attach an image"
            className="rounded-lg bg-neutral-800 px-4 py-3 font-medium disabled:opacity-60"
          >
            🖼️
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            className="flex-1 rounded-lg bg-neutral-800 p-3 outline-none"
          />
          <button
            onClick={() => sendMessage()}
            disabled={sending || uploadingImage}
            className="rounded-lg bg-blue-600 px-5 py-3 font-medium disabled:opacity-60"
          >
            {uploadingImage ? 'Uploading…' : 'Send'}
          </button>
        </div>
      )}
    </div>
  )
}
