import NewConversationButton from './new-conversation-button'

// The conversation list itself now lives in the persistent sidebar
// (sidebar.tsx) — this page is just the "nothing selected yet" landing
// state, the same role ChatGPT/Gemini's blank composer screen plays.
export default function HomePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
      <div
        aria-hidden="true"
        className="h-16 w-16 rounded-full opacity-90 blur-[1px]"
        style={{
          background: 'var(--accent-gradient)',
          boxShadow: '0 0 60px rgba(139, 92, 246, 0.35)'
        }}
      />
      <h1 className="font-display accent-text text-2xl tracking-wide">SOFII</h1>
      <p className="max-w-sm text-sm text-[var(--text-muted)]">
        Pick up a conversation from the sidebar, or start a new one.
      </p>
      <NewConversationButton />
    </div>
  )
}
