// Network-first service worker: always fetch the latest version, fall back to
// the cached copy when offline (car rides!). The app is cached on first visit.
const CACHE = 'ttq-v11';
const SHELL = [
  './', './index.html', './results.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/results-page.js', './js/screens.js', './js/game.js', './js/modes.js',
  './js/srs.js', './js/facts.js', './js/store.js', './js/codec.js', './js/certs.js',
  './js/results-view.js', './js/charts.js', './js/flashcards.js', './js/family.js', './js/family-view.js', './js/config.js', './js/race.js', './js/race-mode.js', './js/versus.js', './js/versus-mode.js', './js/duel.js', './js/live.js', './js/room.js', './js/vendor/peerjs-1.5.5.min.js', './js/fx.js', './js/sfx.js', './js/util.js',
  './icons/icon-192.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    } catch {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
