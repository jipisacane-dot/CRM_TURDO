// Service Worker para Turdo CRM — push notifications + cache strategy.
// Registrado desde src/main.tsx con scope '/'.
//
// Strategy:
//  - /assets/* (JS/CSS con hash en el nombre) → cache-first (immutable, hash cambia con cada build)
//  - Iconos, fonts, manifest → cache-first
//  - HTML, navegación → network-first con fallback a cache (offline-friendly)
//  - API calls (Supabase) → no cachear (passthrough)
//  - Storage URLs (signed) → no cachear (expiran)

const CACHE_VERSION = 'v4';
const STATIC_CACHE = `turdo-static-${CACHE_VERSION}`;
const HTML_CACHE = `turdo-html-${CACHE_VERSION}`;

// Archivos críticos para que la app pueda arrancar offline
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install: precache + activar inmediatamente ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch((e) => console.warn('[SW] precache fail', e))
    )
  );
  self.skipWaiting();
});

// ── Activate: limpiar caches viejos + tomar control ────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('turdo-') && k !== STATIC_CACHE && k !== HTML_CACHE)
            .map((k) => caches.delete(k))
        )
      ),
      self.clients.claim(),
    ])
  );
});

// ── Fetch: routing por tipo de request ─────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // No interceptar requests a APIs externas (Supabase, Tokko, Meta, etc.)
  if (url.origin !== self.location.origin) return;

  // Storage URLs no se cachean (signed URLs, expiran)
  if (url.pathname.startsWith('/storage/')) return;

  // /assets/* tienen hash en el nombre → cache-first, immutable
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Iconos, fonts, favicon → cache-first
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/manifest.webmanifest' ||
    /\.(woff2?|ttf|eot|png|svg|webp|jpg|jpeg)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Navegación (HTML) → network-first, fallback a cache
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req, HTML_CACHE));
    return;
  }
});

// Cache-first: si está en cache lo sirve sin red. Si no, fetch + guarda.
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

// Network-first: intenta red, si falla cae a cache.
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(req) || await cache.match('/');
    if (cached) return cached;
    throw e;
  }
}

// ── Push handler ────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Turdo CRM', body: event.data.text() };
  }

  const title = data.title || 'Turdo CRM';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || data.contact_id || 'turdo-crm',
    renotify: true,
    requireInteraction: false,
    vibrate: [80, 40, 80],
    data: {
      url: data.url || '/inbox',
      contact_id: data.contact_id,
    },
    actions: data.contact_id ? [
      { action: 'open', title: 'Abrir chat' },
      { action: 'dismiss', title: 'Descartar' },
    ] : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Click en notificación ──────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/inbox';
  const contactId = event.notification.data?.contact_id;
  const fullUrl = contactId ? `${targetUrl}?lead=${contactId}` : targetUrl;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client && client.url.includes(self.location.origin)) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(fullUrl);
          }
          client.postMessage({ type: 'NAVIGATE', url: fullUrl });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullUrl);
      }
    })
  );
});

self.addEventListener('sync', () => {
  // Background sync reservado
});
