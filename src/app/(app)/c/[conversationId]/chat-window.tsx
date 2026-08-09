'use client'

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { toast } from 'sonner'
import {
  ArrowDown,
  BookmarkPlus,
  Camera,
  Check,
  Download,
  ImagePlus,
  Link2,
  Link2Off,
  Loader2,
  Mic,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  User,
  Volume2,
  VolumeX,
  Wand2,
  X,
  Zap
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resizeImageToJpeg } from '@/lib/image/resize'
import { downloadConversationAsMarkdown } from '@/lib/export/markdown'
import {
  detectConfidentScriptLanguage,
  detectSpeechLanguage,
  keepSpeechAlive,
  loadVoices,
  pickBestVoice,
  SPEECH_PITCH,
  SPEECH_RATE,
  stripEmojisForSpeech
} from '@/lib/voice/select-voice'
import { fetchCloudSpeech, supportsCloudVoice } from '@/lib/voice/cloud-tts'
import VoiceOrb from './voice-orb'
import { CopyButton, ShareButton, AssistantContent } from './message-content'
import { notifyConversationsChanged } from '../../sidebar'
import { Tooltip } from '../../tooltip'
import { ModelPicker, useSelectedModel, MODEL_INFO, type ModelChoice } from '../../model-picker'
import type { ChatMessage } from '@/lib/db/messages'

type Props = {
  conversationId: string
  title: string
  initialShareToken: string | null
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

// Locale pinned to 'en-US' (rather than the runtime default) so formatting
// is identical between Next's server render and the browser's hydration —
// left as undefined, Node's default ICU locale and the browser's can
// disagree on details like whether AM/PM is included, which is a real
// hydration mismatch (verified live: server produced "11:50", client
// produced "11:50 AM" for the same timestamp).
function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const SPEECH_RMS_THRESHOLD = 0.02
const SILENCE_TO_STOP_MS = 1200
const MAX_WAIT_FOR_SPEECH_MS = 6000

/**
 * Lightweight energy-based voice-activity detection: watches live mic
 * amplitude and calls back once the user has spoken and then gone quiet for
 * SILENCE_TO_STOP_MS, or gives up after MAX_WAIT_FOR_SPEECH_MS of hearing
 * nothing at all. Runs for every recording, hands-free or manual push-to-
 * talk — a manual recording that's never explicitly stopped now auto-stops
 * itself the same way, rather than recording indefinitely until the user
 * remembers to click Stop. The explicit Stop button/click still works
 * exactly as before either way; this only adds a second way a recording
 * can end.
 */
function attachSilenceAutoStop(
  stream: MediaStream,
  onSilence: (heardSpeech: boolean) => void,
  // Fires the moment real speech is first detected, not just at the end —
  // lets the caller track "has anything actually been said yet" in real
  // time (see heardSpeechRef's own comment) so a manual Stop click part
  // way through a silent recording can tell the difference from one where
  // the user genuinely spoke and then stopped.
  onSpeechStart?: () => void
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
      if (!hasSpoken) onSpeechStart?.()
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

export default function ChatWindow({
  conversationId,
  title,
  initialShareToken,
  initialMessages
}: Props) {
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
  const [savingImageIds, setSavingImageIds] = useState<Set<string>>(new Set())
  const [savedImageIds, setSavedImageIds] = useState<Set<string>>(new Set())
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [model, setModel] = useSelectedModel()
  // Which model actually answered each assistant message — read off the
  // response's X-Model header, not persisted server-side (see
  // model-picker.tsx), so this resets on reload; that's an acceptable
  // trade-off for keeping model choice a lightweight per-browser toggle
  // rather than a schema change.
  const [messageModels, setMessageModels] = useState<Record<string, ModelChoice>>({})
  // Whether the view should keep following new content as it streams in.
  // Starts true (a fresh conversation should land at the bottom) and flips
  // to false the moment the user scrolls up to reread something — without
  // this, every streamed token force-scrolled the view back down, making it
  // impossible to read earlier messages while a reply was still generating.
  const [stickToBottom, setStickToBottom] = useState(true)
  const [shareToken, setShareToken] = useState(initialShareToken)
  const [sharing, setSharing] = useState(false)
  const reducedMotion = useReducedMotion()
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<BlobPart[]>([])
  const imageInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const programmaticScrollRef = useRef(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const vadStopRef = useRef<(() => void) | null>(null)
  // Reset to false at the start of every recording — see startRecording's
  // own comment on why this must never default to true.
  const heardSpeechRef = useRef(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const prefillSentRef = useRef(false)
  const activeRecordingIsHandsFreeRef = useRef(false)
  // Set only once a transcription in this conversation has come back with
  // confident, unambiguous script evidence (e.g. Devanagari) — see
  // detectConfidentScriptLanguage's own comment on why this never starts
  // as a guess, and why "confident" specifically requires a meaningful
  // share of the text to be in that script, not just one stray character.
  // Once set, every later recording in this conversation passes it to
  // Whisper as a hint, which is what actually stops the language from
  // flip-flopping turn to turn (the reported Hindi-transcribed-as-Chinese
  // bug) instead of re-guessing from scratch on every single utterance.
  const speechLangHintRef = useRef<string | null>(null)
  // The currently-playing cloud-TTS <audio> element, if any — tracked
  // separately from the browser voice path (which has its own built-in
  // "one utterance at a time" queue via speechSynthesis) since a plain
  // Audio element has no equivalent; stopAnySpeech() below is the single
  // place that knows how to interrupt whichever path is currently talking.
  const cloudAudioRef = useRef<HTMLAudioElement | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  const stopAnySpeech = (): void => {
    window.speechSynthesis.cancel()
    if (cloudAudioRef.current) {
      cloudAudioRef.current.pause()
      cloudAudioRef.current = null
    }
  }

  useEffect(() => {
    // Warms the browser's voice list on mount rather than waiting for the
    // first spoken reply to trigger it — Chrome in particular can take up
    // to ~1s to populate speechSynthesis.getVoices() on a cold page load
    // (see loadVoices' own comment), which otherwise added that delay to
    // the very first reply after a user turns spoken replies on.
    void loadVoices()
    return () => {
      stopAnySpeech()
    }
  }, [])

  // Runs on every messages change, including each streamed chunk (each one
  // is its own setMessages call), so the view keeps following a reply as it
  // streams in — but only while stickToBottom is true, so a user who's
  // scrolled up to reread something doesn't get yanked back down mid-stream.
  useEffect(() => {
    const container = messagesContainerRef.current
    if (container && stickToBottom) container.scrollTop = container.scrollHeight
  }, [messages, stickToBottom])

  const SCROLL_BOTTOM_THRESHOLD_PX = 80

  const handleMessagesScroll = (): void => {
    const container = messagesContainerRef.current
    if (!container) return
    // Ignored while a "Jump to latest" smooth-scroll is in flight — the
    // scroll events fired mid-animation reflect a position that hasn't
    // reached the bottom yet, and without this guard they'd flip
    // stickToBottom back to false before the animation settles, leaving the
    // button stuck visible even though the view is about to be at the
    // bottom anyway.
    if (programmaticScrollRef.current) return
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    setStickToBottom(distanceFromBottom < SCROLL_BOTTOM_THRESHOLD_PX)
  }

  const scrollToLatest = (): void => {
    const container = messagesContainerRef.current
    if (container) {
      programmaticScrollRef.current = true
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
      window.setTimeout(() => {
        programmaticScrollRef.current = false
      }, 500)
    }
    setStickToBottom(true)
  }

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

  // Signature stays synchronous (callers fire-and-forget this, matching
  // this file's established `void someAsyncCall()` convention elsewhere) —
  // the voice lookup below is awaited internally instead.
  const speak = (text: string, onEnd?: () => void): void => {
    // Stripped once, up front, and used for everything below (language
    // detection, both TTS paths) — a TTS engine reading emoji literally
    // (announcing "waving hand emoji" or garbling a pronunciation attempt)
    // reads as broken, not expressive. A reply that was emoji-only becomes
    // empty here and is correctly treated the same as no reply at all.
    const spokenText = stripEmojisForSpeech(text)
    if (!speakEnabled || !spokenText) {
      onEnd?.()
      return
    }
    stopAnySpeech()

    void (async () => {
      const lang = detectSpeechLanguage(spokenText)

      // Cloud TTS (Groq-hosted Orpheus) first, for the languages it
      // covers — genuinely natural neural voice quality, not just "the
      // best of the browser's built-in options". Falls through to the
      // browser voice on any failure (network error, the Groq-side terms
      // gate not cleared yet, rate limiting) rather than ever being a dead
      // end for spoken replies.
      if (supportsCloudVoice(lang)) {
        const audioBlob = await fetchCloudSpeech(spokenText, lang)
        if (audioBlob) {
          const url = URL.createObjectURL(audioBlob)
          const audio = new Audio(url)
          cloudAudioRef.current = audio
          setIsSpeaking(true)
          const finish = (): void => {
            URL.revokeObjectURL(url)
            if (cloudAudioRef.current === audio) cloudAudioRef.current = null
            setIsSpeaking(false)
            onEnd?.()
          }
          audio.onended = finish
          audio.onerror = finish
          try {
            await audio.play()
            return
          } catch {
            finish()
            // falls through to the browser voice below
          }
        }
      }

      const utterance = new SpeechSynthesisUtterance(spokenText)
      // Matches the utterance to an actual installed voice for whatever
      // language it's speaking, instead of the browser's single unnamed
      // default (previously never set at all — every reply, in every
      // language, played through whichever voice the OS happened to
      // default to, which is also often its lowest-quality one).
      const voices = await loadVoices()
      const voice = pickBestVoice(voices, lang)
      utterance.lang = voice?.lang ?? lang
      if (voice) utterance.voice = voice
      // Slightly slower and a touch warmer than a TTS engine's narration
      // default — reads as more attentive/polite, less rushed.
      utterance.rate = SPEECH_RATE
      utterance.pitch = SPEECH_PITCH

      // isSpeaking gates the wake-word listener below (see that effect) so
      // it doesn't arm itself while Sofii's own voice is playing through
      // the speakers — otherwise the mic could pick up her own reply and
      // misinterpret it as containing the wake word.
      setIsSpeaking(true)
      // Chrome silently stalls/cuts off long utterances without this —
      // see keepSpeechAlive's own comment. Stopped on both end and error
      // so the interval never outlives the utterance it belongs to.
      const stopKeepAlive = keepSpeechAlive()
      const finish = (): void => {
        stopKeepAlive()
        setIsSpeaking(false)
        onEnd?.()
      }
      utterance.onend = finish
      utterance.onerror = finish
      window.speechSynthesis.speak(utterance)
    })()
  }

  // Shared by the gallery input, the camera input, and paste-from-clipboard
  // — one resize/preview path regardless of where the image came from.
  const handleImageFile = async (file: File): Promise<void> => {
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
      toast.error(message)
    } finally {
      setUploadingImage(false)
    }
  }

  const handleImageSelect = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await handleImageFile(file)
  }

  // Ctrl/Cmd+V an image straight into the composer — desktop's equivalent
  // of the mobile camera/gallery buttons, no file dialog needed. Only
  // intercepts when the clipboard actually contains an image; a normal text
  // paste falls through untouched.
  const handleComposerPaste = async (e: ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    if (!item) return
    const file = item.getAsFile()
    if (!file) return
    e.preventDefault()
    await handleImageFile(file)
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
        body: JSON.stringify({ conversationId, model, ...payload }),
        signal: controller.signal
      })

      if (!response.ok || !response.body) return { content: '', ok: false }

      const answeredBy = response.headers.get('X-Model')
      if (answeredBy === 'groq' || answeredBy === 'gemini') {
        setMessageModels((prev) => ({ ...prev, [assistantId]: answeredBy }))
      }

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

  // Feeds an already-uploaded chat image into the real ingestion/OCR
  // pipeline (the same one Documents page uploads go through) so it
  // becomes a searchable document instead of living only in this one
  // conversation's context. Chat images sit in the public chat-images
  // bucket, so their URL works with /api/ingest's URL-ingestion path
  // unchanged — no new upload, just handing over the existing public URL.
  const saveImageAsDocument = async (messageId: string, imageUrl: string): Promise<void> => {
    setSavingImageIds((prev) => new Set(prev).add(messageId))
    try {
      const response = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: imageUrl })
      })
      if (!response.ok) throw new Error(await response.text())

      setSavedImageIds((prev) => new Set(prev).add(messageId))
      toast.success('Saved to Documents — searchable in chat and on the Documents page shortly.')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Could not save image as a document: ${message}`)
    } finally {
      setSavingImageIds((prev) => {
        const next = new Set(prev)
        next.delete(messageId)
        return next
      })
    }
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
        toast.error(`Image upload failed: ${message}`)
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

    setStickToBottom(true)
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
        void startRecording({ handsFree: true })
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

  // handsFree covers voiceTurnActive/auto-continue-after-reply behavior
  // only — silence-based auto-stop itself (attachSilenceAutoStop below) now
  // runs for every recording, manual push-to-talk included. It used to be
  // gated behind this same flag, which meant clicking the mic button
  // manually never auto-stopped at all: the recording just ran until the
  // user clicked Stop themselves, regardless of how long they'd already
  // finished talking.
  const startRecording = async (options?: { handsFree?: boolean }): Promise<void> => {
    // Set here (covering every hands-free recording, whatever triggered
    // it — wake word, or an auto-continue after a reply to a typed
    // message while Jarvis mode happens to be on) rather than only where
    // the wake word is detected: that would leave a gap where this
    // specific recording's later transcribing/sending stage isn't covered
    // by voiceTurnActive, letting the wake-word listener incorrectly
    // re-arm mid-turn.
    if (options?.handsFree) setVoiceTurnActive(true)
    activeRecordingIsHandsFreeRef.current = !!options?.handsFree

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })
      audioChunksRef.current = []
      // Starts false, not true: previously defaulted to true and only the
      // VAD's own eventual onSilence callback (below) ever set it — so a
      // manual Stop click before that fired (the common case: click, say
      // nothing, click again) left it stuck at its initial true, and a
      // near-silent clip got transcribed anyway. Whisper can hallucinate
      // real-looking text from silence, which is exactly the "it always
      // takes something on its own" bug this fixes. onSpeechStart below
      // flips this the moment real speech is actually detected, so it's
      // accurate at whatever instant a Stop click (manual or automatic)
      // happens, not just at the end of the recording.
      heardSpeechRef.current = false
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
          const hint = speechLangHintRef.current
          const url = hint ? `/api/voice/transcribe?language=${hint}` : '/api/voice/transcribe'
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'audio/webm' },
            body: blob
          })

          if (!response.ok) throw new Error(await response.text())

          const { text } = (await response.json()) as { text: string }
          // Locks in a hint for every later recording in this conversation
          // once real script evidence shows up — see speechLangHintRef's
          // own comment. detectConfidentScriptLanguage (not the plain
          // detectScriptLanguage) specifically: a single stray character
          // from a transcription artifact must never be enough to commit
          // to a hint that then persists and actively distorts every
          // later turn — a real bug, not a hypothetical one.
          // Never downgraded back to null by Latin-script text afterward:
          // a confirmed non-English speaker occasionally saying an
          // English word/name shouldn't reset the hint.
          const detectedScript = detectConfidentScriptLanguage(text)
          if (detectedScript) speechLangHintRef.current = detectedScript.split('-')[0]

          if (text.trim()) {
            // sendMessage clears voiceTurnActive itself once the whole
            // reply (including speaking it) is done. fromHandsFree tells
            // it whether it's allowed to auto-continue afterward — only
            // true for a wake-word-triggered or auto-continued recording,
            // never a manual push-to-talk one.
            await sendMessage(text.trim(), { fromHandsFree: !!options?.handsFree })
          } else {
            setVoiceTurnActive(false)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          toast.error(`Transcription failed: ${message}`)
          setVoiceTurnActive(false)
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)

      // Runs for every recording now, not just hands-free ones — see this
      // function's own comment.
      vadStopRef.current = attachSilenceAutoStop(
        stream,
        (heardSpeech) => {
          heardSpeechRef.current = heardSpeech
          if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop()
          }
          setIsRecording(false)
        },
        () => {
          heardSpeechRef.current = true
        }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Microphone unavailable: ${message}`)
      setVoiceTurnActive(false)
    }
  }

  const stopRecording = (): void => {
    vadStopRef.current?.()
    vadStopRef.current = null
    if (mediaRecorderRef.current?.state === 'recording') {
      // A manual Stop click during a hands-free (Jarvis) recording always
      // means "cancel this turn", even if the user had started speaking —
      // routed through the same "no speech heard" bail-out onstop already
      // has for VAD giving up, skipping transcription entirely. Without
      // this, stopping mid-turn still transcribed whatever was captured so
      // far, sending an unwanted partial message whose reply (Jarvis still
      // on) reopened the mic again — the exact "stop doesn't stop, it
      // reopens" loop this fixes. This is a deliberate hands-free-only
      // override, separate from the general "was anything actually said"
      // tracking startRecording's onSpeechStart callback does — a manual
      // (non-hands-free) push-to-talk Stop click doesn't hit this branch
      // at all, so heardSpeechRef is left exactly as accurate as it
      // already was in real time.
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
        toast.error("Wake-word mode needs Chrome or Edge — this browser doesn't support it.")
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
          void startRecording({ handsFree: true })
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

  // Generates a fresh token (src/app/api/conversations/[conversationId]/share/route.ts
  // POST) and copies the resulting link immediately — sharing and copying are the
  // same action from the user's point of view, no reason to make it two steps.
  const handleShareConversation = async (): Promise<void> => {
    setSharing(true)
    try {
      const response = await fetch(`/api/conversations/${conversationId}/share`, {
        method: 'POST'
      })
      if (!response.ok) throw new Error('Failed to create share link')
      const { url } = (await response.json()) as { url: string }
      await navigator.clipboard.writeText(url)
      setShareToken(url.split('/share/')[1])
      toast.success('Share link copied to clipboard')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(message)
    } finally {
      setSharing(false)
    }
  }

  const handleCopyShareLink = async (): Promise<void> => {
    if (!shareToken) return
    await navigator.clipboard.writeText(`${window.location.origin}/share/${shareToken}`)
    toast.success('Share link copied to clipboard')
  }

  // Sets share_token back to null — the old link 404s immediately (the
  // public page looks it up by exact token match, see
  // src/app/share/[token]/page.tsx).
  const handleRevokeShare = async (): Promise<void> => {
    setSharing(true)
    try {
      const response = await fetch(`/api/conversations/${conversationId}/share`, {
        method: 'DELETE'
      })
      if (!response.ok) throw new Error('Failed to stop sharing')
      setShareToken(null)
      toast.success('Stopped sharing this conversation')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(message)
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-end gap-1.5 sm:gap-3">
        <AnimatePresence>
          {isWakeListening && (
            <motion.span
              initial={reducedMotion ? false : { opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 6 }}
              aria-label='Listening for "Sofii"'
              className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 animate-pulse rounded-full"
                style={{ background: 'var(--accent-gradient)' }}
              />
              <span className="hidden sm:inline">Listening for &ldquo;Sofii&rdquo;…</span>
            </motion.span>
          )}
        </AnimatePresence>
        <ModelPicker model={model} onChange={setModel} />
        <Tooltip label={wakeWordEnabled ? 'Jarvis mode on — say "Sofii" anytime' : 'Enable Jarvis mode'}>
          <motion.button
            whileTap={reducedMotion ? undefined : { scale: 0.94 }}
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
            aria-label="Toggle Jarvis hands-free mode"
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition sm:px-3 ${
              wakeWordEnabled
                ? 'text-[var(--accent-gradient-text)]'
                : 'border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
            style={wakeWordEnabled ? { background: 'var(--accent-gradient)' } : undefined}
          >
            <Wand2 size={13} />
            <span className="hidden sm:inline">Jarvis</span>
          </motion.button>
        </Tooltip>
        <Tooltip label={speakEnabled ? 'Spoken replies on' : 'Spoken replies off'}>
          <motion.button
            whileTap={reducedMotion ? undefined : { scale: 0.9 }}
            onClick={() =>
              setSpeakEnabled((prev) => {
                if (prev) stopAnySpeech()
                return !prev
              })
            }
            aria-label={speakEnabled ? 'Turn off spoken replies' : 'Turn on spoken replies'}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover-strong)] hover:text-[var(--text)] sm:p-1"
          >
            {speakEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </motion.button>
        </Tooltip>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <motion.button
              whileTap={reducedMotion ? undefined : { scale: 0.9 }}
              aria-label="More conversation options"
              title="More options"
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover-strong)] hover:text-[var(--text)] sm:p-1"
            >
              <MoreHorizontal size={17} />
            </motion.button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="radix-pop glass z-[70] min-w-44 rounded-lg border border-[var(--border-strong)] p-1 shadow-[var(--shadow-md)]"
            >
              <DropdownMenu.Item
                onSelect={() => downloadConversationAsMarkdown(messages, title)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-muted)] outline-none data-[highlighted]:bg-[var(--surface-active)] data-[highlighted]:text-[var(--text)]"
              >
                <Download size={14} />
                Export as Markdown
              </DropdownMenu.Item>
              {shareToken ? (
                <>
                  <DropdownMenu.Item
                    onSelect={() => void handleCopyShareLink()}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-muted)] outline-none data-[highlighted]:bg-[var(--surface-active)] data-[highlighted]:text-[var(--text)]"
                  >
                    <Link2 size={14} />
                    Copy share link
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={sharing}
                    onSelect={() => void handleRevokeShare()}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--danger)] outline-none data-[highlighted]:bg-red-500/10 data-[disabled]:opacity-60"
                  >
                    <Link2Off size={14} />
                    Stop sharing
                  </DropdownMenu.Item>
                </>
              ) : (
                <DropdownMenu.Item
                  disabled={sharing}
                  onSelect={() => void handleShareConversation()}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-muted)] outline-none data-[highlighted]:bg-[var(--surface-active)] data-[highlighted]:text-[var(--text)] data-[disabled]:opacity-60"
                >
                  <Link2 size={14} />
                  {sharing ? 'Sharing…' : 'Share conversation'}
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="relative min-h-0 flex-1">
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="h-full overflow-y-auto px-1 py-2"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <AnimatePresence initial={false}>
            {messages.map((m, i) => {
              const isLastAssistantReply =
                m.role === 'assistant' && i === messages.length - 1 && !!m.content && !sending
              const isStreamingPlaceholder =
                m.role === 'assistant' && i === messages.length - 1 && !m.content && sending
              const answeredBy = messageModels[m.id]
              return (
                <motion.div
                  key={m.id}
                  layout={!reducedMotion}
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className={`group ${m.role === 'user' ? 'flex justify-end' : ''}`}
                >
                  {m.role === 'user' ? (
                  <div className="flex max-w-[85%] items-start gap-2.5 sm:max-w-[70%]">
                    <div className="min-w-0 flex-1">
                      {m.image_url && (
                        <div className="mb-2 ml-auto w-fit">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={m.image_url}
                            alt="Attached"
                            className="max-h-64 max-w-full rounded-lg object-contain"
                          />
                          <Tooltip
                            label={
                              savedImageIds.has(m.id)
                                ? 'Saved to Documents'
                                : 'Save this image as a document — searchable later, goes through OCR'
                            }
                          >
                            <button
                              onClick={() => void saveImageAsDocument(m.id, m.image_url!)}
                              disabled={savingImageIds.has(m.id) || savedImageIds.has(m.id)}
                              aria-label="Save image as document"
                              className="mt-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-button-hover)] hover:text-[var(--text)] disabled:opacity-60"
                            >
                              {savingImageIds.has(m.id) ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : savedImageIds.has(m.id) ? (
                                <Check size={12} />
                              ) : (
                                <BookmarkPlus size={12} />
                              )}
                              {savedImageIds.has(m.id) ? 'Saved' : 'Save as document'}
                            </button>
                          </Tooltip>
                        </div>
                      )}
                      {editingId === m.id ? (
                        <div className="rounded-2xl rounded-tr-sm border border-[var(--border-strong)] bg-[var(--surface-input-strong)] p-2">
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
                              className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--surface-button-hover)]"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => void commitEdit(m.id)}
                              className="rounded-md px-2 py-1 font-medium text-[var(--accent-gradient-text)]"
                              style={{ background: 'var(--accent-gradient)' }}
                            >
                              Save & submit
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div
                            className="rounded-2xl rounded-tr-sm border border-[var(--border)] px-4 py-2.5 text-sm whitespace-pre-wrap"
                            style={{ background: 'var(--user-bubble-bg)', color: 'var(--user-bubble-text)' }}
                          >
                            {m.content}
                          </div>
                          <div className="mt-1 flex items-center justify-end gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                            <span className="text-xs text-[var(--text-muted)]">
                              {formatTime(m.created_at)}
                            </span>
                            <CopyButton content={m.content} />
                            <ShareButton content={m.content} />
                            <Tooltip label="Edit">
                              <button
                                onClick={() => startEdit(m)}
                                aria-label="Edit message"
                                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-button-hover)] hover:text-[var(--text)]"
                              >
                                <Pencil size={13} />
                                Edit
                              </button>
                            </Tooltip>
                          </div>
                        </>
                      )}
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-hover-strong)] text-[var(--text-muted)]"
                    >
                      <User size={14} />
                    </div>
                  </div>
                ) : (
                  <div className="flex max-w-[90%] gap-3">
                    <div
                      aria-hidden="true"
                      className="mt-0.5 h-7 w-7 shrink-0 rounded-full"
                      style={{
                        background: 'var(--accent-gradient)',
                        boxShadow: 'var(--avatar-glow-sm)'
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
                      {isStreamingPlaceholder ? (
                        <div className="typing-dots" aria-label="Sofii is thinking">
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : (
                        <AssistantContent content={m.content} />
                      )}
                      <div className="mt-1 flex items-center gap-2 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                        {!isStreamingPlaceholder && (
                          <span className="text-xs text-[var(--text-muted)]">
                            {formatTime(m.created_at)}
                          </span>
                        )}
                        <CopyButton content={m.content} />
                        {!isStreamingPlaceholder && <ShareButton content={m.content} />}
                        {isLastAssistantReply && (
                          <Tooltip label="Regenerate">
                            <button
                              onClick={() => void regenerate(m.id)}
                              aria-label="Regenerate response"
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-button-hover)] hover:text-[var(--text)]"
                            >
                              <RotateCcw size={13} />
                              Regenerate
                            </button>
                          </Tooltip>
                        )}
                        {answeredBy && !isStreamingPlaceholder && (
                          <span className="model-badge">
                            {answeredBy === 'groq' ? <Zap size={11} /> : <Sparkles size={11} />}
                            {MODEL_INFO[answeredBy].label}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                </motion.div>
              )
            })}
          </AnimatePresence>
          {isTranscribing && <div className="text-sm text-[var(--text-muted)]">Transcribing…</div>}
        </div>
      </div>
      <AnimatePresence>
        {!stickToBottom && (
          <motion.button
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            whileTap={reducedMotion ? undefined : { scale: 0.94 }}
            onClick={scrollToLatest}
            aria-label="Jump to latest message"
            className="glass absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--text)] shadow-[var(--shadow-md)]"
          >
            <ArrowDown size={13} />
            Jump to latest
          </motion.button>
        )}
      </AnimatePresence>
      </div>

      <AnimatePresence>
        {pendingImage && (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, scale: 0.9, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="mx-auto mt-3 w-full max-w-3xl"
          >
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingImage.previewUrl}
                alt="To send"
                className="h-20 w-20 rounded-xl border border-[var(--border)] object-cover shadow-[var(--shadow-md)]"
              />
              <Tooltip label="Remove image">
                <motion.button
                  whileTap={reducedMotion ? undefined : { scale: 0.88 }}
                  onClick={clearPendingImage}
                  aria-label="Remove attached image"
                  className="glass absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-strong)] text-[var(--text)] shadow-[var(--shadow-sm)] hover:bg-[var(--surface-button-hover)]"
                >
                  <X size={13} />
                </motion.button>
              </Tooltip>
            </div>
            <p className="mt-1.5 max-w-20 truncate text-xs text-[var(--text-muted)]">
              {pendingImage.file.name}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isRecording && micStream && (
          // Fixed, viewport-centered overlay (not just centered within the
          // composer strip) — a full "voice mode" takeover like Gemini
          // Live/Jarvis, not a small inline indicator.
          <motion.div
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-black/90 backdrop-blur-sm"
          >
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <VoiceOrb stream={micStream} size={260} />
            </motion.div>
            <p className="text-sm text-[var(--text-muted)]">Listening…</p>
            <Tooltip label="Stop recording" side="bottom">
              <motion.button
                whileTap={reducedMotion ? undefined : { scale: 0.92 }}
                onClick={stopRecording}
                aria-label="Stop recording"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-[0_0_30px_rgba(239,68,68,0.45)]"
              >
                <Square size={18} fill="currentColor" />
              </motion.button>
            </Tooltip>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="accent-ring mx-auto mt-4 flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-2">
        <Tooltip label="Start recording">
          <motion.button
            whileTap={reducedMotion ? undefined : { scale: 0.9 }}
            onClick={toggleRecording}
            disabled={isTranscribing}
            aria-label="Start voice recording"
            className="relative rounded-xl px-3 py-2.5 hover:bg-[var(--surface-hover-strong)] disabled:opacity-60"
          >
            {isWakeListening && !reducedMotion && (
              <motion.span
                aria-hidden="true"
                className="absolute inset-1 rounded-lg"
                style={{ background: 'var(--accent-gradient)' }}
                animate={{ opacity: [0.35, 0.05, 0.35], scale: [1, 1.25, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
            <Mic size={18} className="relative" />
          </motion.button>
        </Tooltip>
        <Tooltip label="Take a photo">
          <motion.button
            whileTap={reducedMotion ? undefined : { scale: 0.9 }}
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploadingImage}
            aria-label="Take a photo"
            className="rounded-xl px-3 py-2.5 hover:bg-[var(--surface-hover-strong)] disabled:opacity-60 md:hidden"
          >
            <Camera size={18} />
          </motion.button>
        </Tooltip>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleImageSelect}
          className="hidden"
        />
        <Tooltip label="Attach an image">
          <motion.button
            whileTap={reducedMotion ? undefined : { scale: 0.9 }}
            onClick={() => imageInputRef.current?.click()}
            disabled={uploadingImage}
            aria-label="Attach an image"
            className="rounded-xl px-3 py-2.5 hover:bg-[var(--surface-hover-strong)] disabled:opacity-60"
          >
            <ImagePlus size={18} />
          </motion.button>
        </Tooltip>
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
          onPaste={(e) => void handleComposerPaste(e)}
          placeholder="Message Sofii..."
          className="max-h-[200px] flex-1 resize-none bg-transparent p-2 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <motion.button
          whileTap={reducedMotion ? undefined : { scale: 0.95 }}
          onClick={sending ? handleStop : () => sendMessage()}
          disabled={uploadingImage}
          aria-label={sending ? 'Stop generating' : 'Send message'}
          className={`flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-medium text-[var(--accent-gradient-text)] transition disabled:opacity-60 ${
            sending ? 'bg-red-500 text-white' : ''
          }`}
          style={sending ? undefined : { background: 'var(--accent-gradient)' }}
        >
          {uploadingImage ? (
            'Uploading…'
          ) : sending ? (
            <>
              <Square size={14} fill="currentColor" />
              Stop
            </>
          ) : (
            <>
              <Send size={14} />
              Send
            </>
          )}
        </motion.button>
      </div>
    </div>
  )
}
