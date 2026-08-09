import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCatchUp, shouldShowCatchUp, touchLastActive } from '@/lib/db/catch-up'
import { CatchUpPanel } from './catch-up-panel'
import HomeComposer from './home-composer'

// The conversation list itself lives in the persistent sidebar
// (sidebar.tsx) — this page is the "nothing selected yet" landing state.
//
// It renders one of two ways:
// - Returning after a while with something pending: a real catch-up of
//   what happened while away, with the composer underneath.
// - Otherwise: the clean centered composer, the same role ChatGPT/Gemini's
//   blank screen plays.
//
// A Server Component so the catch-up data loads in the same render as the
// page rather than flashing in after a client fetch.
export default async function HomePage() {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  let catchUp = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('last_active_at')
      .eq('id', user.id)
      .maybeSingle()

    catchUp = await getCatchUp(supabase, profile?.last_active_at ?? null)

    // Recorded after the catch-up is computed (it reads the OLD value to
    // decide the window) and via after() so it never delays the render —
    // this is bookkeeping, not something the page output depends on.
    after(() => touchLastActive(supabase, user.id))
  }

  if (catchUp && shouldShowCatchUp(catchUp)) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-6 p-6">
        <CatchUpPanel catchUp={catchUp} />
        <HomeComposer compact />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div
        aria-hidden="true"
        className="h-16 w-16 rounded-full opacity-90 blur-[1px]"
        style={{
          background: 'var(--accent-gradient)',
          boxShadow: 'var(--avatar-glow-lg)'
        }}
      />
      <h1 className="font-display accent-text text-2xl tracking-wide">SOFII</h1>
      <p className="max-w-sm text-sm text-[var(--text-muted)]">
        Ask anything, or pick a starting point below.
      </p>
      <div className="w-full max-w-xl">
        <HomeComposer />
      </div>
    </div>
  )
}
