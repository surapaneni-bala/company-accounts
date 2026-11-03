// Keeps a copy of the app on the phone/computer so it opens with no internet.
// The test copy is built with its own prefix (tools/build.js --test), so the two never delete each other's saved copy.
const PREFIX = 'accounts-';
const CACHE = PREFIX + '4adb2c2d69';
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
// Phone notifications (owner, 3 Nov 2026): the Google Sheet sends them through Firebase as data; one of a kind replaces the last
// on the phone (tag). Tapping one opens the app's 🔔.
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = {}; }
  const d = m.data || m.notification || {};
  e.waitUntil(self.registration.showNotification(d.title || 'Brookfield', { body: d.body || 'Something needs you — open Brookfield.', tag: d.tag || 'brookfield', renotify: true, icon: 'icon-192.png', data: { url: d.url || './?bell=1' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './?bell=1', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(w => w.url.startsWith(self.registration.scope));
    if (open) { open.postMessage({ bell: true }); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
// App files come from the saved copy first. Sync calls to Google are never cached.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
