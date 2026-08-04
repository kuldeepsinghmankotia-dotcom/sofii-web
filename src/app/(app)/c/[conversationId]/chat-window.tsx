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

export default function ChatWindow({ conversationId, initialMessages }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [speakEnabled, setSpeakEnabled] = useState(false)
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

  const speak = (text: string): void => {
    if (!speakEnabled || !text.trim()) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
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
    speak(fullContent)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') sendMessage()
  }

  const toggleRecording = async (): Promise<void> => {
    if (isRecording) {
      mediaRecorderRef.current?.stop()
      setIsRecording(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })
      audioChunksRef.current = []
      setMicStream(stream)

      recorder.ondataavailable = (e): void => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async (): Promise<void> => {
        stream.getTracks().forEach((track) => track.stop())
        setMicStream(null)
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
          if (text.trim()) await sendMessage(text.trim())
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          addSystemNote(`Transcription failed: ${message}`)
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addSystemNote(`Microphone unavailable: ${message}`)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex justify-end">
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
            onClick={toggleRecording}
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
