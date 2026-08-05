'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export const TooltipProvider = TooltipPrimitive.Provider

// Thin wrapper around Radix's Tooltip so every icon-only button in the app
// gets an accessible, consistently styled hover/focus label with one import
// instead of each call site re-wiring Root/Trigger/Portal/Content.
export function Tooltip({
  children,
  label,
  side = 'top'
}: {
  children: ReactNode
  label: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="radix-tooltip glass z-[70] rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text)] shadow-[var(--shadow-sm)]"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-[var(--bg-elevated)]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
