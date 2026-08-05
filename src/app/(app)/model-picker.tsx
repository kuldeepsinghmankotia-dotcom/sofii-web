'use client'

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Sparkles, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'

export type ModelChoice = 'groq' | 'gemini'

const STORAGE_KEY = 'sofii:model'

export const MODEL_INFO: Record<ModelChoice, { label: string; hint: string }> = {
  groq: { label: 'Groq · gpt-oss-120b', hint: 'Fastest' },
  gemini: { label: 'Gemini · 3.6 Flash', hint: 'Google' }
}

function readStoredModel(): ModelChoice {
  if (typeof window === 'undefined') return 'groq'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'gemini' ? 'gemini' : 'groq'
}

// Model choice is a per-browser preference, not per-conversation state —
// deliberately not persisted server-side (no schema change) so switching
// providers stays a lightweight, instant UI action.
export function useSelectedModel(): [ModelChoice, (model: ModelChoice) => void] {
  const [model, setModel] = useState<ModelChoice>('groq')

  useEffect(() => {
    // Deferred rather than called synchronously in the effect body — this
    // project's react-hooks/set-state-in-effect rule (React Compiler) flags
    // that as cascading-render-prone.
    queueMicrotask(() => setModel(readStoredModel()))
  }, [])

  const update = (next: ModelChoice): void => {
    setModel(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  return [model, update]
}

export function ModelPicker({
  model,
  onChange
}: {
  model: ModelChoice
  onChange: (model: ModelChoice) => void
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          {model === 'groq' ? <Zap size={13} /> : <Sparkles size={13} />}
          {MODEL_INFO[model].label}
          <ChevronDown size={13} className="opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="radix-pop glass z-[70] min-w-56 rounded-xl border border-[var(--border-strong)] p-1 shadow-[var(--shadow-md)]"
        >
          {(Object.keys(MODEL_INFO) as ModelChoice[]).map((key) => (
            <DropdownMenu.Item
              key={key}
              onSelect={() => onChange(key)}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[var(--text-muted)] outline-none data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-[var(--text)]"
            >
              {key === 'groq' ? <Zap size={14} /> : <Sparkles size={14} />}
              <span className="flex-1">
                <span className="block text-[var(--text)]">{MODEL_INFO[key].label}</span>
                <span className="block text-xs">{MODEL_INFO[key].hint}</span>
              </span>
              {model === key && <Check size={14} className="accent-text shrink-0" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
