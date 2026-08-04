'use client'

import { useEffect } from 'react'
import type { Reminder } from '@/lib/db/reminders'

const POLL_INTERVAL_MS = 30_000

/**
 * Mounted once in the authenticated app shell. Requests Notification
 * permission up front (same one-time-prompt pattern as the mic permission
 * for voice), then polls /api/reminders/poll on an interval and shows a
 * native browser Notification for anything that comes due. Only fires while
 * this tab is open — see the poll route's doc comment for the full caveat.
 */
export default function ReminderPoller(): null {
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch('/api/reminders/poll', { method: 'POST' })
        if (!response.ok) return

        const { reminders } = (await response.json()) as { reminders: Reminder[] }
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

        for (const reminder of reminders) {
          new Notification('Sofii Reminder', { body: reminder.content })
        }
      } catch {
        // Best-effort: a failed poll just waits for the next interval.
      }
    }

    void poll()
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  return null
}
