// Family Calendar PWA SW v6
const PRECACHE = 'fc-precache-v6';
const RUNTIME = 'fc-runtime-v6';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(PRECACHE).then(c => c.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k===PRECACHE||k===RUNTIME)?null:caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request; const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(PRECACHE);
      const cached = await cache.match('/index.html');
      try { return await fetch(req); } catch { return cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } }); }
    })());
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try { const fresh = await fetch(req); cache.put(req, fresh.clone()); return fresh; } catch { return cached || Response.error(); }
    })());
    return;
  }
  event.respondWith(fetch(req).catch(() => Response.error()));
});
