// Service worker: keeps the app shell and viewed book pages for slow or broken
// connections. API data is network-first with a cached fallback for reading
// screens only; nothing is cached for staff/admin endpoints.
const VERSION = 'qimmah-1.0.0';
const SHELL = ['/', '/index.html', '/app.css?v=1.0.0', '/app.js?v=1.0.0', '/manifest.webmanifest', '/favicon.png', '/icons/icon-96.png', '/icons/icon-192.png'];
const READ_API = /^\/api\/(home|subjects\/\d+|lessons\/\d+|announcements|attempts\/mine)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'qimmah-book' && k !== 'qimmah-api').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/book/')) {
    e.respondWith(caches.open('qimmah-book').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (!READ_API.test(url.pathname)) return;
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open('qimmah-api').then((c) => c.put(req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req)) || Response.error()));
    return;
  }
  if (url.pathname.startsWith('/download/')) return;
  // app shell: cache first, refresh in background
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => hit || caches.match('/'));
    return hit || net;
  }));
});
