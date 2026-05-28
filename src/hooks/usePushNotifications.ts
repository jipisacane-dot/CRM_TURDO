import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

const VAPID_PUBLIC_ENV = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

let _vapidCache: string | null = null;
async function getVapidPublic(): Promise<string> {
  if (VAPID_PUBLIC_ENV) return VAPID_PUBLIC_ENV;
  if (_vapidCache) return _vapidCache;
  try {
    const { data } = await supabase.functions.invoke('get-vapid-public', { body: {} });
    const key = (data as { vapidPublicKey?: string })?.vapidPublicKey;
    if (key) {
      _vapidCache = key;
      return key;
    }
  } catch (e) {
    console.error('get-vapid-public err', e);
  }
  return '';
}

// Resuelve el agent_id REAL del vendor logueado consultando agents.id via
// auth_user_id de la sesión actual de Supabase Auth. Antes leía crm_session
// legacy que ya no se usa con el sistema de auth real → siempre caía al
// fallback 'leticia' y TODAS las subscriptions quedaban a nombre de Leti.
// Bug reportado 28/05/2026: vendedores activaban notifs pero nunca recibían.
async function resolveAgentId(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const authUserId = session?.user?.id;
    if (!authUserId) return null;
    const { data } = await supabase
      .from('agents')
      .select('id')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error('[push] resolveAgentId err:', e);
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  return arr.buffer;
}

export type PushStatus = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

export const usePushNotifications = () => {
  const [status, setStatus] = useState<PushStatus>('unsubscribed');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // iOS Safari < 16.4 + WebView de algunas apps NO tienen Notification ni PushManager.
    // Sin estos guards rompe con "undefined is not an object" al cargar el CRM.
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
      setStatus('unsupported'); return;
    }
    if (Notification.permission === 'denied') {
      setStatus('denied'); return;
    }
    // Check if already subscribed
    try {
      navigator.serviceWorker.ready.then(reg => {
        reg.pushManager.getSubscription().then(sub => {
          setStatus(sub ? 'subscribed' : 'unsubscribed');
        }).catch(() => setStatus('unsupported'));
      }).catch(() => setStatus('unsupported'));
    } catch {
      setStatus('unsupported');
    }
  }, []);

  const subscribe = async () => {
    setLoading(true);
    try {
      if (typeof Notification === 'undefined') {
        alert('Tu navegador no soporta notificaciones. En iPhone necesitás instalar el CRM como app (Compartir → Agregar a inicio) para recibirlas.');
        setStatus('unsupported');
        return;
      }
      const vapidKey = await getVapidPublic();
      if (!vapidKey) {
        alert('No se pudo obtener la clave VAPID. Avisá al admin.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const key = sub.getKey('p256dh');
      const auth = sub.getKey('auth');
      if (!key || !auth) throw new Error('Missing push keys');

      const p256dh = btoa(String.fromCharCode(...new Uint8Array(key)));
      const authStr = btoa(String.fromCharCode(...new Uint8Array(auth)));

      // CRITICAL: resolver el agent_id real del usuario logueado.
      // Si no podemos resolverlo, NO guardamos la subscription (mejor null que
      // guardarla como 'leticia' y romper notifs para todos).
      const agentId = await resolveAgentId();
      if (!agentId) {
        alert('No se pudo identificar tu usuario. Cerrá sesión, volvé a entrar e intentá de nuevo.');
        return;
      }

      await supabase.from('push_subscriptions').upsert(
        { agent_id: agentId, endpoint: sub.endpoint, p256dh, auth: authStr },
        { onConflict: 'endpoint' }
      );

      setStatus('subscribed');
    } catch (e) {
      console.error('Push subscribe error:', e);
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        setStatus('denied');
      }
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus('unsubscribed');
    } finally {
      setLoading(false);
    }
  };

  return { status, loading, subscribe, unsubscribe };
};
