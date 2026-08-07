import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// Shared header for the secondary tool pages (Memories/Reminders/Documents/
// Calendar) — keeps the icon+title+description treatment identical across
// them instead of each page hand-rolling its own slightly different markup.
export function PageHeader({
  icon: Icon,
  title,
  description
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
}) {
  return (
    <div className="mb-6">
      <h1 className="flex items-center gap-2 text-xl font-bold text-[var(--text)]">
        <Icon size={20} className="accent-icon" />
        {title}
      </h1>
      {description && <p className="mt-2 text-sm text-[var(--text-muted)]">{description}</p>}
    </div>
  )
}
