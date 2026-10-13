// Service worker: caches the app shell so the app opens and works with no
// internet. Bump VERSION whenever any cached file changes.
const VERSION = 'ftcs-v2';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'js/storage.js',
  'js/toa.js',
  'js/qr.js',
  'js/analysis.js',
  'js/schedule.js',
  'js/ftcscout.js',
  'js/datasource.js',
  'vendor/qrcode.js',
  'vendor/jsQR.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never cache API calls; the app stores event data itself.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network first so updates show up when online, cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
