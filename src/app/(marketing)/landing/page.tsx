import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  Brain,
  FileText,
  GitBranch,
  Languages,
  Mic,
  Sparkles,
  Wrench
} from 'lucide-react'

// Real metadata, because the point of this page is to be linked and
// shared — a link with no title/description preview converts far worse.
export const metadata: Metadata = {
  title: 'Sofii — the assistant that actually remembers',
  description:
    'Sofii remembers every conversation, reads your documents, and shows you exactly why it answered the way it did. Voice-first, multilingual, and honest about its sources.',
  openGraph: {
    title: 'Sofii — the assistant that actually remembers',
    description:
      'Remembers every conversation, reads your documents, and shows its sources. Voice-first and multilingual.',
    type: 'website'
  }
}

const FEATURES = [
  {
    icon: Brain,
    title: 'It remembers across conversations',
    body: 'Ask "what did we decide about that last month?" in a brand-new chat and Sofii finds it. Most assistants treat every conversation as a sealed box — this one searches all of them.'
  },
  {
    icon: Sparkles,
    title: 'It shows its work',
    body: 'Every reply carries a "Why this answer" panel listing the exact memories, documents, past conversations and actions behind it. No black box, no guessing whether it made something up.'
  },
  {
    icon: GitBranch,
    title: 'Branch any conversation',
    body: 'Fork from any message to explore a different direction, without destroying the thread that got you there.'
  },
  {
    icon: FileText,
    title: 'Reads what you give it',
    body: 'PDF, Word, PowerPoint, Excel, CSV, Markdown, images via OCR, or just paste a URL. Everything becomes searchable in conversation.'
  },
  {
    icon: Mic,
    title: 'Genuinely voice-first',
    body: 'Say "Sofii" and start talking — no clicking. It stops listening when you stop speaking, and answers out loud in a natural voice.'
  },
  {
    icon: Wrench,
    title: 'It does things, not just talks',
    body: 'Reminders, calendar, web search, reading pages, exact calculations, saving notes — all callable mid-conversation.'
  }
]

export default function LandingPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
      <header className="mb-4 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-6 w-6 rounded-full"
          style={{ background: 'var(--accent-gradient)', boxShadow: 'var(--avatar-glow-sm)' }}
        />
        <span className="font-display accent-text text-sm tracking-wide">SOFII</span>
      </header>

      <section className="mb-16 max-w-2xl">
        <h1 className="mb-4 text-4xl leading-tight font-bold text-[var(--text)] sm:text-5xl">
          The assistant that actually{' '}
          <span className="accent-text">remembers</span>
        </h1>
        <p className="mb-8 text-lg leading-relaxed text-[var(--text-muted)]">
          Most AI chats forget everything the moment you close the tab. Sofii keeps your
          conversations, documents and preferences — and tells you exactly what it used to answer.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-[var(--accent-gradient-text)] shadow-[var(--shadow-md)]"
            style={{ background: 'var(--accent-gradient)' }}
          >
            Get started free <ArrowRight size={15} />
          </Link>
          <Link
            href="/sign-in"
            className="rounded-xl border border-[var(--border-strong)] px-5 py-3 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="mb-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5 transition hover:border-[var(--border-strong)]"
          >
            <feature.icon size={18} className="accent-icon mb-3" aria-hidden="true" />
            <h2 className="mb-1.5 text-sm font-semibold text-[var(--text)]">{feature.title}</h2>
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">{feature.body}</p>
          </div>
        ))}
      </section>

      <section className="mb-16 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-6">
        <Languages size={18} className="accent-icon mb-3" aria-hidden="true" />
        <h2 className="mb-1.5 text-sm font-semibold text-[var(--text)]">
          Speaks your language — properly
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">
          Talk to Sofii in Hindi, Chinese, Arabic, Spanish, French and around 30 other languages. It
          detects what you&apos;re speaking, keeps the thread in that language, and replies out loud
          in a natural neural voice rather than a robotic one.
        </p>
      </section>

      <footer className="border-t border-[var(--border)] pt-6 text-sm text-[var(--text-muted)]">
        <p className="mb-3">
          Sofii is in active development and free while it&apos;s early. Your feedback shapes what
          gets built next — there&apos;s a Help &amp; feedback box inside the app.
        </p>
        <Link href="/sign-up" className="text-[var(--accent-a)] hover:underline">
          Create an account →
        </Link>
      </footer>
    </div>
  )
}
