import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
const AGENT_ID = 'leticia'; // will come from auth when multi-user is implemented

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
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported'); return;
    }
    if (Notification.permission === 'denied') {
      setStatus('denied'); return;
    }
    // Check if already subscribed
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setStatus(sub ? 'subscribed' : 'unsubscribed');
      });
    });
  }, []);

  const subscribe = async () => {
    if (!VAPID_PUBLIC) {
      console.warn('VITE_VAPID_PUBLIC_KEY not set');
      return;
    }
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });

      const key = sub.getKey('p256dh');
      const auth = sub.getKey('auth');
      if (!key || !auth) throw new Error('Missing push keys');

      const p256dh = btoa(String.fromCharCode(...new Uint8Array(key)));
      const authStr = btoa(String.fromCharCode(...new Uint8Array(auth)));

      await supabase.from('push_subscriptions').upsert(
        { agent_id: AGENT_ID, endpoint: sub.endpoint, p256dh, auth: authStr },
        { onConflict: 'endpoint' }
      );

      setStatus('subscribed');
    } catch (e) {
      console.error('Push subscribe error:', e);
      if (Notification.permission === 'denied') setStatus('denied');
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
