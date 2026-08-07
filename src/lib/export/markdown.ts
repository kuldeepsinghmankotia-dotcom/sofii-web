import type { ChatMessage } from '@/lib/db/messages'

// Assistant replies are already markdown (see SYSTEM_PROMPT in
// src/lib/groq/client.ts), so they're inlined as-is rather than re-escaped
// — the exported file reads exactly like the in-app rendering. User
// messages are plain text, wrapped as a blockquote to visually separate
// turns without needing any markdown escaping of their own.
export function formatConversationAsMarkdown(messages: ChatMessage[], title: string): string {
  const lines = [`# ${title}`, '']

  for (const m of messages) {
    if (!m.content.trim() && !m.image_url) continue

    if (m.role === 'user') {
      lines.push('**You:**', '')
      lines.push(...m.content.split('\n').map((line) => `> ${line}`))
      if (m.image_url) lines.push(`> \n> [Attached image](${m.image_url})`)
    } else {
      lines.push('**Sofii:**', '')
      lines.push(m.content)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// Filename-safe slug from the conversation title, capped so a very long
// auto-generated title doesn't produce an unwieldy filename.
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (slug || 'conversation').slice(0, 60)
}

export function downloadConversationAsMarkdown(messages: ChatMessage[], title: string): void {
  const markdown = formatConversationAsMarkdown(messages, title)
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${slugify(title)}.md`
  link.click()

  URL.revokeObjectURL(url)
}
