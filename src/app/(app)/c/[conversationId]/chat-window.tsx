'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<BlobPart[]>([])

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel()
    }
  }, [])

  const speak = (text: string): void => {
    if (!speakEnabled || !text.trim()) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  }

  const sendMessage = async (overrideContent?: string): Promise<void> => {
    const content = overrideContent ?? input
    if (!content.trim() || sending) return

    if (overrideContent === undefined) setInput('')
    setSending(true)

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      created_at: new Date().toISOString()
    }

    const assistantId = crypto.randomUUID()
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString()
    }

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder])

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, content })
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

  const addSystemNote = (content: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        created_at: new Date().toISOString()
      }
    ])
  }

  const toggleRecording = async (): Promise<void> => {
    if (isRecording) {
      mediaRecorderRef.current?.stop()
      setIsRecording(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      audioChunksRef.current = []

      recorder.ondataavailable = (e): void => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async (): Promise<void> => {
        stream.getTracks().forEach((track) => track.stop())
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
    <div className="flex flex-1 flex-col overflow-hidden">
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

      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[75%] rounded-xl p-3 whitespace-pre-wrap ${
              m.role === 'user' ? 'ml-auto bg-blue-600' : 'bg-neutral-800'
            }`}
          >
            {m.content}
          </div>
        ))}
        {isTranscribing && <div className="ml-auto text-sm text-neutral-400">Transcribing…</div>}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={toggleRecording}
          disabled={isTranscribing}
          title={isRecording ? 'Stop recording' : 'Start recording'}
          className={`rounded-lg px-4 py-3 font-medium disabled:opacity-60 ${
            isRecording ? 'bg-red-600' : 'bg-neutral-800'
          }`}
        >
          {isRecording ? '⏹' : '🎙️'}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          className="flex-1 rounded-lg bg-neutral-800 p-3 outline-none"
        />
        <button
          onClick={() => sendMessage()}
          disabled={sending}
          className="rounded-lg bg-blue-600 px-5 py-3 font-medium disabled:opacity-60"
        >
          Send
        </button>
      </div>
    </div>
  )
}
