const CACHE = 'swaip-v9';
const OFFLINE_URLS = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;

  /* HTML-страницы (index.html и SPA-роуты) — всегда с сети */
  const url = new URL(e.request.url);
  const isHtml = e.request.headers.get('accept')?.includes('text/html') ||
    url.pathname === '/' || !url.pathname.includes('.');
  if (isHtml) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match('/') || caches.match(e.request))
    );
    return;
  }

  /* JS/CSS/assets — сеть с кэшем как fallback */
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});

/* ── Показать уведомление по команде от страницы ── */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_BOOKING_NOTIFICATION') {
    const { title, body, tag } = e.data;
    self.registration.showNotification(title, {
      body,
      icon: '/swaip-logo.png',
      badge: '/swaip-logo.png',
      vibrate: [200, 100, 200, 100, 300],
      tag: tag || 'booking',
      renotify: true,
      requireInteraction: false,
    });
  }
});

/* ── Тап по уведомлению — открывает приложение ── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
