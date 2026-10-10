// Keeps a copy of the app on the phone/computer so it opens with no internet.
// The test copy is built with its own prefix (tools/build.js --test), so the two never delete each other's saved copy.
const PREFIX = 'test-accounts-';
const CACHE = PREFIX + 'a6f23bf069';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo-wide.png', 'watermark.png'];

self.addEventListener('install', e => {
  // cache: 'reload' = straight from the internet, never a stored older copy of the page
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// App files come from the saved copy first. Sync calls to Google are never cached.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
