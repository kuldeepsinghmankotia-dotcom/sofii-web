import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * What a tool page shows before it has anything in it.
 *
 * Every one of these pages previously answered an empty list with a single
 * flat sentence — "No reminders yet." — which tells the user what is missing
 * and nothing about what to do, or why the feature is worth using. An empty
 * screen is the first thing a new user meets on most of these pages, so it
 * is doing more work than any other state and deserved more than a full stop.
 *
 * Deliberately restrained: a soft icon, one line of purpose, and optional
 * examples. No illustrations, no marketing — this appears often enough that
 * anything louder would wear thin.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  examples,
  onExampleClick,
  children
}: {
  icon: LucideIcon
  title: string
  description: string
  /** Concrete things the user could do, shown as prompts. */
  examples?: string[]
  onExampleClick?: (example: string) => void
  children?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-strong)] px-6 py-10 text-center">
      <div
        aria-hidden="true"
        className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-subtle)]"
      >
        <Icon size={19} className="accent-icon" />
      </div>

      <p className="mb-1 text-sm font-medium text-[var(--text)]">{title}</p>
      <p className="mx-auto max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>

      {examples && examples.length > 0 && (
        <ul className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2">
          {examples.map((example) => (
            <li key={example}>
              {onExampleClick ? (
                <button
                  onClick={() => onExampleClick(example)}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                >
                  {example}
                </button>
              ) : (
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
                  {example}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
