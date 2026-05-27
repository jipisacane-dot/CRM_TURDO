// Banner que aparece en mobile arriba del contenido cuando las notificaciones
// push están desactivadas. Tap para activar. Una vez activadas, no se muestra.
// Si el user las rechazó (denied), tampoco se muestra — solo en estado neutral.
//
// Razón de existencia: Leti reportó que en mobile no hay forma de activar
// notificaciones porque el botón solo está en la Sidebar desktop (hidden md:flex).
// MobileNav no tiene un slot disponible, así que un banner dismissible es la
// solución natural.

import { useState } from 'react';
import { usePushNotifications } from '../hooks/usePushNotifications';

const DISMISSED_KEY = 'mobile_notif_banner_dismissed_until';

export default function MobileNotifBanner() {
  const { status, loading, subscribe } = usePushNotifications();
  const [dismissed, setDismissed] = useState(() => {
    try {
      const v = localStorage.getItem(DISMISSED_KEY);
      if (!v) return false;
      return Date.now() < parseInt(v, 10);
    } catch { return false; }
  });

  // Solo mostrar si estado es unsubscribed (no soportado/denied/subscribed → ocultar)
  if (status !== 'unsubscribed' || dismissed) return null;

  const handleDismiss = () => {
    // Dismiss por 24h
    const until = Date.now() + 24 * 60 * 60 * 1000;
    try { localStorage.setItem(DISMISSED_KEY, String(until)); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    <div className="md:hidden bg-amber-50 border-b border-amber-200 px-3 py-2 flex items-center gap-2 flex-shrink-0">
      <span className="text-base flex-shrink-0">🔔</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-amber-900">Activá las notificaciones</div>
        <div className="text-[11px] text-amber-800 leading-tight">Para enterarte de mensajes nuevos sin tener el CRM abierto.</div>
      </div>
      <button
        onClick={() => void subscribe()}
        disabled={loading}
        className="flex-shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
      >
        {loading ? '...' : 'Activar'}
      </button>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 text-amber-700 hover:text-amber-900 px-1"
        title="Recordármelo mañana"
      >
        ✕
      </button>
    </div>
  );
}
