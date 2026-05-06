// Service Worker para Turdo CRM — push notifications + click handler.
// Registrado desde src/main.tsx con scope '/'.

const CACHE_NAME = 'turdo-crm-v1';

self.addEventListener('install', (event) => {
  // Activar este SW inmediatamente sin esperar a que se cierren las pestañas viejas
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Tomar control de los clientes inmediatamente
  event.waitUntil(self.clients.claim());
});

// ── Push handler ────────────────────────────────────────────────────────────
// Recibe el payload encriptado de Web Push, lo decodifica y muestra la notif nativa.
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
    // Combina con el tag: notifs del mismo tag se reemplazan en lugar de apilar
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
// Si la app ya está abierta, focusea esa ventana. Si no, abre una nueva.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/inbox';
  const contactId = event.notification.data?.contact_id;
  const fullUrl = contactId ? `${targetUrl}?lead=${contactId}` : targetUrl;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      // Si ya hay una ventana del CRM abierta, focusearla y navegar
      for (const client of clientsList) {
        if ('focus' in client && client.url.includes(self.location.origin)) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(fullUrl);
          }
          // Fallback: postMessage al cliente para que navegue
          client.postMessage({ type: 'NAVIGATE', url: fullUrl });
          return;
        }
      }
      // Si no hay ventana abierta, abrir una nueva
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullUrl);
      }
    })
  );
});

// ── Background sync placeholder ─────────────────────────────────────────────
// Útil más adelante para enviar mensajes pendientes cuando hay conexión.
self.addEventListener('sync', () => {
  // Reservado
});

// Fuerza una variable para que el linter no marque CACHE_NAME como unused
void CACHE_NAME;
