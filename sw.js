// Offline-Cache. Bei neuer Version CACHE hochzählen → App zeigt „Neue Version – Neu laden“.
const CACHE = 'hit-duell-v1';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'kategorien.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Sofort aus dem Cache, im Hintergrund still aktualisieren.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const refresh = () => fetch(e.request).then(async (res) => {
      if (res.ok) await c.put(e.request, res.clone());
      return res;
    });
    if (hit) { e.waitUntil(refresh().catch(() => {})); return hit; }
    return refresh().catch(async () => (await c.match('index.html')) || Response.error());
  }));
});
