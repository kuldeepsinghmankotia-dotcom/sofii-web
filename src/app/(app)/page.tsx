import NewConversationButton from './new-conversation-button'

// The conversation list itself now lives in the persistent sidebar
// (sidebar.tsx) — this page is just the "nothing selected yet" landing
// state, the same role ChatGPT/Gemini's blank composer screen plays.
export default function HomePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Sofii</h1>
      <p className="max-w-sm text-sm text-neutral-400">
        Pick up a conversation from the sidebar, or start a new one.
      </p>
      <NewConversationButton />
    </div>
  )
}
