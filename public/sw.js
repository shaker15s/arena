/**
 * Masar 3.2 — Service Worker (WEB-02)
 * يحفظ القشرة الثابتة للتطبيق (App Shell) والأصول المبوّبة للعمل دون اتصال،
 * مع استثناء جميع طلبات Supabase API / Auth / Realtime من التخزين المؤقت.
 */
const CACHE_NAME = 'masar-shell-v3.2.0';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/404.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Supabase REST, Auth, Storage, Functions, or Realtime requests
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/rest/v1') ||
    url.pathname.startsWith('/auth/v1') ||
    url.pathname.startsWith('/realtime/v1') ||
    url.pathname.startsWith('/storage/v1') ||
    url.pathname.startsWith('/functions/v1')
  ) {
    return;
  }

  // Immutable hashed Expo assets: Cache-First
  if (url.pathname.startsWith('/_expo/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Navigation requests: Network-First with fallback to cached /index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() =>
          caches.match('/index.html').then((cached) => cached || caches.match('/404.html')),
        ),
    );
    return;
  }

  // Other same-origin static assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
});
