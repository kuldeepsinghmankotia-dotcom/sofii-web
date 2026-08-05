'use client'

import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { createClient } from '@/lib/supabase/client'
import { resizeImageToJpeg } from '@/lib/image/resize'
import VoiceOrb from './voice-orb'
import { notifyConversationsChanged } from '../../sidebar'
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

function CopyButton({ content, label }: { content: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied/unavailable in some browser contexts
      // — not worth surfacing an error for a copy button.
    }
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy"
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text)]"
    >
      {copied ? '✓ Copied' : `⧉ ${label ?? 'Copy'}`}
    </button>
  )
}

// rehype-highlight (wired in below) tags fenced code blocks' inner <code>
// with a `language-xxx` class; this wraps that in a small header (language
// label + a copy button reading the rendered <pre>'s own text, so it always
// copies exactly what's on screen) instead of a bare unlabeled block —
// matching the Copilot/ChatGPT code-block treatment.
function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const codeElement = Array.isArray(children) ? children[0] : children
  const language = isValidElement<{ className?: string }>(codeElement)
    ? (codeElement.props.className ?? '').match(/language-(\w+)/)?.[1]
    : undefined

  const handleCopy = async (): Promise<void> => {
    const text = preRef.current?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied/unavailable — not worth an error UI.
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language ?? 'code'}</span>
        <button onClick={handleCopy} className="code-block-copy">
          {copied ? '✓ Copied' : '⧉ Copy'}
        </button>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  )
}

// Renders assistant replies as structured markdown (headings, lists, bold,
// code, tables) instead of one raw text blob — the "ChatGPT/Copilot" look
// the user asked for. Tight custom element spacing (via the `md` class in
// globals.css) rather than a full prose plugin, since a chat bubble needs
// much less vertical margin than an article body.
function AssistantContent({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          pre: (props) => <CodeBlock>{props.children}</CodeBlock>
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<BlobPart[]>([])
  const imageInputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const vadStopRef = useRef<(() => void) | null>(null)
  const heardSpeechRef = useRef(true)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const prefillSentRef = useRef(false)
  const activeRecordingIsHandsFreeRef = useRef(false)
  const router = useRouter()
  const searchParams = useSearchParams()

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

  // Auto-growing composer (ChatGPT-style: starts single-line, grows with
  // content up to a cap, then scrolls) — recalculated by resetting to
  // 'auto' first so shrinking (e.g. after clearing on send) isn't stuck at
  // whatever the tallest height was.
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

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

  // Shared by sendMessage and regenerate: POSTs to /api/chat and streams the
  // response into the given placeholder message. Wired to an AbortController
  // so a Stop click (see handleStop) can cut generation short — the reading
  // loop's AbortError is caught and treated as a clean stop (whatever
  // streamed so far is kept as the final content), not an error state.
  const streamReplyInto = async (
    assistantId: string,
    payload: { content?: string; imageUrl?: string; regenerate?: boolean }
  ): Promise<{ content: string; ok: boolean }> => {
    const controller = new AbortController()
    abortControllerRef.current = controller
    let fullContent = ''

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, ...payload }),
        signal: controller.signal
      })

      if (!response.ok || !response.body) return { content: '', ok: false }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        fullContent += chunk
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))
        )
      }

      return { content: fullContent, ok: true }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      return { content: fullContent, ok: aborted }
    } finally {
      abortControllerRef.current = null
    }
  }

  const handleStop = (): void => {
    abortControllerRef.current?.abort()
  }

  // Deletes the current reply and asks the server for a fresh one from the
  // same, already-stored user message (regenerate: true tells the route to
  // skip inserting a new user message and reuse the last one in history —
  // see api/chat/route.ts).
  const regenerate = async (assistantId: string): Promise<void> => {
    if (sending) return
    const target = messages.find((m) => m.id === assistantId)
    if (!target || target.role !== 'assistant') return

    setSending(true)
    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: '' } : m)))

    const supabase = createClient()
    await supabase.from('messages').delete().eq('id', assistantId)

    const { ok } = await streamReplyInto(assistantId, { regenerate: true })
    setSending(false)

    if (!ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: 'Something went wrong.' } : m))
      )
      return
    }

    notifyConversationsChanged()
  }

  const startEdit = (message: ChatMessage): void => {
    setEditingId(message.id)
    setEditValue(message.content)
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setEditValue('')
  }

  // Edits a past user message and resends it as a fresh turn — everything
  // from that message onward (its old reply, and any later turns) is
  // discarded both locally and in the DB, matching ChatGPT's "edit rewinds
  // the conversation" behavior rather than just changing the text in place.
  const commitEdit = async (id: string): Promise<void> => {
    const newContent = editValue.trim()
    setEditingId(null)
    if (!newContent || sending) return

    const index = messages.findIndex((m) => m.id === id)
    if (index === -1) return

    const idsToDelete = messages.slice(index).map((m) => m.id)
    setMessages((prev) => prev.slice(0, index))

    if (idsToDelete.length > 0) {
      const supabase = createClient()
      await supabase.from('messages').delete().in('id', idsToDelete)
    }

    await sendMessage(newContent)
  }

  const sendMessage = async (
    overrideContent?: string,
    options?: { fromHandsFree?: boolean }
  ): Promise<void> => {
    const content = overrideContent ?? input
    if ((!content.trim() && !pendingImage) || sending) return

    // Captured before this turn's messages are pushed: whether the sidebar
    // should expect a server-side auto-title rename once this reply lands
    // (see the delayed notifyConversationsChanged() below).
    const isFirstMessage = messages.length === 0

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

    const { content: fullContent, ok } = await streamReplyInto(assistantId, { content, imageUrl })
    setSending(false)

    if (!ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: 'Something went wrong.' } : m))
      )
      setVoiceTurnActive(false)
      return
    }

    // Bumps this conversation to the top of the sidebar's list right away.
    // If this was the conversation's first exchange, the server also
    // auto-titles it (api/chat/route.ts, after this response stream already
    // closed) — there's no signal back to the client for exactly when that
    // finishes, so a second, delayed notify catches it heuristically rather
    // than the sidebar showing "New conversation" until its next unrelated
    // refresh.
    notifyConversationsChanged()
    if (isFirstMessage) setTimeout(notifyConversationsChanged, 2500)

    // In hands-free mode, keep the conversation going after the spoken
    // reply finishes — a real Jarvis-style back-and-forth instead of
    // requiring the wake word again for every turn. Gated on
    // options?.fromHandsFree (not just wakeWordEnabled) so this only
    // chains additional turns onto an ALREADY hands-free exchange (wake
    // word, or a previous auto-continue) — a manually typed message or a
    // manual mic press no longer reopens the mic afterward just because
    // Jarvis mode happens to be toggled on elsewhere. If the user says
    // nothing, the VAD's own give-up timeout (see attachSilenceAutoStop)
    // drops this back to passive wake-word listening on its own.
    speak(fullContent, () => {
      if (wakeWordEnabled && options?.fromHandsFree) {
        void startRecording({ autoStopOnSilence: true })
      } else {
        setVoiceTurnActive(false)
      }
    })
  }

  // Home page's suggested-prompt / inline composer creates the conversation
  // first, then navigates here with the text as a query param — this fires
  // that first message once the chat window itself has mounted, then strips
  // the param so a refresh (or the browser back button) doesn't resend it.
  // prefillSentRef guards against React 18 Strict Mode's dev-only
  // double-invoke of effects, which would otherwise send this message
  // twice — the empty dependency array alone isn't enough since Strict
  // Mode intentionally re-runs a fresh mount's effects once to surface
  // exactly this kind of non-idempotent side effect.
  useEffect(() => {
    const prefill = searchParams.get('prefill')
    if (!prefill || prefillSentRef.current) return
    prefillSentRef.current = true
    router.replace(`/c/${conversationId}`)
    void sendMessage(prefill)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
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
    activeRecordingIsHandsFreeRef.current = !!options?.autoStopOnSilence

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
            // reply (including speaking it) is done. fromHandsFree tells
            // it whether it's allowed to auto-continue afterward — only
            // true for a wake-word-triggered or auto-continued recording,
            // never a manual push-to-talk one.
            await sendMessage(text.trim(), { fromHandsFree: !!options?.autoStopOnSilence })
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
      // A manual Stop click during a hands-free (Jarvis) recording means
      // "cancel this turn" — routed through the same "no speech heard"
      // bail-out onstop already has for VAD giving up, skipping
      // transcription entirely. Without this, stopping mid-turn still
      // transcribed a near-silent clip; Whisper can hallucinate non-empty
      // text from that, sending an unwanted message whose reply (Jarvis
      // still on) reopened the mic again — the exact "stop doesn't stop,
      // it reopens" loop this fixes. Manual (non-hands-free) push-to-talk
      // recordings are unaffected: heardSpeechRef stays whatever it
      // already was (true, since nothing else touches it in that path).
      if (activeRecordingIsHandsFreeRef.current) heardSpeechRef.current = false
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
          <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ background: 'var(--accent-gradient)' }}
            />
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
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            wakeWordEnabled
              ? 'text-black'
              : 'border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
          style={wakeWordEnabled ? { background: 'var(--accent-gradient)' } : undefined}
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

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-1 py-2">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {messages.map((m, i) => {
            const isLastAssistantReply =
              m.role === 'assistant' && i === messages.length - 1 && !!m.content && !sending
            return (
              <div
                key={m.id}
                className={`message-enter group ${m.role === 'user' ? 'flex justify-end' : ''}`}
              >
                {m.role === 'user' ? (
                  <div className="max-w-[75%]">
                    {m.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.image_url}
                        alt="Attached"
                        className="mb-2 max-h-64 max-w-full rounded-lg object-contain"
                      />
                    )}
                    {editingId === m.id ? (
                      <div className="rounded-2xl rounded-tr-sm border border-[var(--border-strong)] bg-black/30 p-2">
                        <textarea
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              void commitEdit(m.id)
                            } else if (e.key === 'Escape') {
                              cancelEdit()
                            }
                          }}
                          rows={Math.min(8, editValue.split('\n').length)}
                          className="w-full resize-none bg-transparent text-sm text-[var(--text)] outline-none"
                        />
                        <div className="mt-1 flex justify-end gap-2 text-xs">
                          <button
                            onClick={cancelEdit}
                            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-white/10"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => void commitEdit(m.id)}
                            className="rounded-md px-2 py-1 font-medium text-black"
                            style={{ background: 'var(--accent-gradient)' }}
                          >
                            Save & submit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          className="rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap text-black"
                          style={{ background: 'var(--accent-gradient)' }}
                        >
                          {m.content}
                        </div>
                        <div className="mt-1 flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                          <CopyButton content={m.content} />
                          <button
                            onClick={() => startEdit(m)}
                            title="Edit"
                            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text)]"
                          >
                            ✎ Edit
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div
                      aria-hidden="true"
                      className="mt-0.5 h-7 w-7 shrink-0 rounded-full"
                      style={{
                        background: 'var(--accent-gradient)',
                        boxShadow: '0 0 14px rgba(139,92,246,0.45)'
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      {m.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.image_url}
                          alt="Attached"
                          className="mb-2 max-h-64 max-w-full rounded-lg object-contain"
                        />
                      )}
                      <AssistantContent content={m.content} />
                      <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                        <CopyButton content={m.content} />
                        {isLastAssistantReply && (
                          <button
                            onClick={() => void regenerate(m.id)}
                            title="Regenerate"
                            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text)]"
                          >
                            ↻ Regenerate
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {isTranscribing && <div className="text-sm text-[var(--text-muted)]">Transcribing…</div>}
        </div>
      </div>

      {pendingImage && (
        <div className="mx-auto mt-3 flex w-full max-w-3xl items-center gap-2 rounded-lg border border-[var(--border)] bg-white/[0.03] p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pendingImage.previewUrl}
            alt="To send"
            className="h-12 w-12 rounded object-cover"
          />
          <span className="flex-1 truncate text-sm text-[var(--text-muted)]">
            {pendingImage.file.name}
          </span>
          <button
            onClick={clearPendingImage}
            title="Remove image"
            className="text-[var(--text-muted)] hover:text-[var(--text)]"
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
          <p className="text-sm text-[var(--text-muted)]">Listening…</p>
          <button
            onClick={stopRecording}
            title="Stop recording"
            className="rounded-full bg-red-600 px-8 py-3 font-medium text-white"
          >
            Stop
          </button>
        </div>
      ) : (
        <div className="accent-ring mx-auto mt-4 flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-2">
          <button
            onClick={toggleRecording}
            disabled={isTranscribing}
            title="Start recording"
            className="rounded-xl px-3 py-2.5 text-lg hover:bg-white/5 disabled:opacity-60"
          >
            🎙️
          </button>
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={uploadingImage}
            title="Attach an image"
            className="rounded-xl px-3 py-2.5 text-lg hover:bg-white/5 disabled:opacity-60"
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
          <textarea
            ref={composerRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Sofii... (Shift+Enter for a new line)"
            className="max-h-[200px] flex-1 resize-none bg-transparent p-2 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <button
            onClick={sending ? handleStop : () => sendMessage()}
            disabled={uploadingImage}
            className={`rounded-xl px-5 py-2.5 text-sm font-medium text-black transition disabled:opacity-60 ${
              sending ? 'bg-red-500 text-white' : ''
            }`}
            style={sending ? undefined : { background: 'var(--accent-gradient)' }}
          >
            {uploadingImage ? 'Uploading…' : sending ? 'Stop' : 'Send'}
          </button>
        </div>
      )}
    </div>
  )
}
