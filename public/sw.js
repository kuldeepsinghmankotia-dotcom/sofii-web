// Minimal push-only service worker — no caching/offline strategy, this
// exists solely to receive Web Push events while the app itself is fully
// closed (a plain page can't do that; only a registered service worker
// can wake up for a push event) and to focus/open the app when the
// resulting notification is tapped.

self.addEventListener('push', (event) => {
  let payload = { title: 'Sofii', body: '' }
  try {
    if (event.data) payload = event.data.json()
  } catch {
    // Malformed/non-JSON payload — fall back to the default above rather
    // than dropping the notification entirely.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Sofii', {
      body: payload.body || '',
      icon: '/manifest-icon?size=192',
      badge: '/manifest-icon?size=192',
      data: { url: payload.url || '/' }
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
