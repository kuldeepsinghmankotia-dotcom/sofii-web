'use client'

import { useEffect } from 'react'

// atob-based, not Buffer — this runs in the browser. Converts the VAPID
// public key from the URL-safe base64 string web-push generates into the
// raw byte array pushManager.subscribe() requires as applicationServerKey.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

/**
 * Mounted once in the authenticated app shell, alongside ReminderPoller.
 * Registers the push-only service worker (public/sw.js), requests
 * Notification permission (the single permission prompt point for the
 * app — reminder-poller.tsx no longer requests it separately), and
 * subscribes to Web Push so the daily digest cron
 * (src/app/api/cron/digest/route.ts) can reach this device even with the
 * app fully closed. A no-op on browsers without Push API support (older
 * Safari, some in-app browsers) rather than erroring.
 */
export default function PushSubscribe(): null {
  useEffect(() => {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!publicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return

    const setup = async (): Promise<void> => {
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return
      } else if (Notification.permission !== 'granted') {
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js')
      let subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // TS's DOM lib types Uint8Array's buffer as ArrayBufferLike
          // (which includes SharedArrayBuffer), which doesn't structurally
          // satisfy BufferSource — a known lib.dom.d.ts friction point, not
          // a real runtime concern here.
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
        })
      }

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      })
    }

    void setup()
  }, [])

  return null
}
