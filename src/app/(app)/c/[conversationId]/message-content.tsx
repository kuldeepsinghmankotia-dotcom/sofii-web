'use client'

import { isValidElement, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy, Share2 } from 'lucide-react'

export function CopyButton({ content, label }: { content: string; label?: string }) {
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
      aria-label={copied ? 'Copied' : (label ?? 'Copy')}
      title="Copy"
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-button-hover)] hover:text-[var(--text)]"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : (label ?? 'Copy')}
    </button>
  )
}

// navigator.share opens the OS share sheet on mobile Safari/Chrome (send to
// Messages, WhatsApp, etc.) — where it's unavailable (most desktop
// browsers), falls back to the same copy-to-clipboard UX as CopyButton
// above, so the button always does *something* useful rather than silently
// no-op'ing.
export function ShareButton({ content, label }: { content: string; label?: string }) {
  const [shared, setShared] = useState(false)

  const handleShare = async (): Promise<void> => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: content })
      } catch {
        // Includes the user cancelling the share sheet — not an error.
      }
      return
    }

    try {
      await navigator.clipboard.writeText(content)
      setShared(true)
      setTimeout(() => setShared(false), 1500)
    } catch {
      // Clipboard access can be denied/unavailable — not worth an error UI.
    }
  }

  return (
    <button
      onClick={handleShare}
      aria-label={shared ? 'Copied' : (label ?? 'Share')}
      title="Share"
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-button-hover)] hover:text-[var(--text)]"
    >
      {shared ? <Check size={13} /> : <Share2 size={13} />}
      {shared ? 'Copied' : (label ?? 'Share')}
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
        <button onClick={handleCopy} aria-label={copied ? 'Copied' : 'Copy code'} className="code-block-copy flex items-center gap-1">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
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
export function AssistantContent({ content }: { content: string }) {
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
