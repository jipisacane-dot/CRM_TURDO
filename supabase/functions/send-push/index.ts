import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:turdoleticia@gmail.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── VAPID helpers (manual implementation for Deno) ────────────────────────────

async function importVapidKey(base64: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, usage);
}

async function signVapid(header: string, payload: string, privateKeyB64: string): Promise<string> {
  const keyData = Uint8Array.from(atob(privateKeyB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function buildVapidAuth(endpoint: string): Promise<string> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header  = b64url({ typ: 'JWT', alg: 'ES256' });
  const payload = b64url({ aud: audience, exp, sub: VAPID_SUBJECT });
  const sig = await signVapid(header, payload, VAPID_PRIVATE);
  return `vapid t=${header}.${payload}.${sig}, k=${VAPID_PUBLIC}`;
}

// ── Encrypt push payload ──────────────────────────────────────────────────────

async function encryptPayload(
  payload: string,
  p256dhB64: string,
  authB64: string,
): Promise<{ body: Uint8Array; headers: Record<string, string> }> {
  const enc = new TextEncoder();
  const authBytes = Uint8Array.from(atob(authB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  // Server key pair
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
  const serverPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));

  // Client public key
  const clientPublicRaw = Uint8Array.from(atob(p256dhB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const clientPublicKey = await crypto.subtle.importKey('raw', clientPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // Shared secret
  const sharedBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientPublicKey }, serverKeys.privateKey, 256));

  // Salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF PRK
  const prk = await crypto.subtle.importKey('raw', sharedBits, { name: 'HKDF' }, false, ['deriveBits']);

  // auth info
  const authInfo = enc.encode('Content-Encoding: auth\0');
  const authInput = new Uint8Array(authInfo.length + authBytes.length);
  authInput.set(authInfo); authInput.set(authBytes, authInfo.length);

  // key material
  const keyInfo = new Uint8Array([...enc.encode('Content-Encoding: aesgcm\0'), ...clientPublicRaw, ...serverPublicRaw]);
  const nonceInfo = new Uint8Array([...enc.encode('Content-Encoding: nonce\0'), ...clientPublicRaw, ...serverPublicRaw]);

  const ikm = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: authInput }, prk, 256);
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);

  const keyBytes = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: keyInfo }, ikmKey, 128));
  const nonceBytes = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: nonceInfo }, ikmKey, 96));

  const aesKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const payloadBytes = enc.encode(payload);
  const padded = new Uint8Array(2 + payloadBytes.length);
  padded.set(payloadBytes, 2);

  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBytes, tagLength: 128 }, aesKey, padded));

  const body = new Uint8Array(salt.length + 4 + 1 + serverPublicRaw.length + encrypted.length);
  let offset = 0;
  body.set(salt, offset); offset += salt.length;
  body[offset++] = 0; body[offset++] = 0; body[offset++] = 16; body[offset++] = 0;
  body[offset++] = serverPublicRaw.length;
  body.set(serverPublicRaw, offset); offset += serverPublicRaw.length;
  body.set(encrypted, offset);

  return {
    body,
    headers: {
      'Content-Encoding': 'aesgcm',
      'Encryption': `salt=${btoa(String.fromCharCode(...salt)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`,
      'Crypto-Key': `dh=${btoa(String.fromCharCode(...serverPublicRaw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`,
    },
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { title, body, contact_id, url } = await req.json() as {
      title: string; body: string; contact_id?: string; url?: string;
    };

    const { data: subs } = await supabase.from('push_subscriptions').select('*');
    if (!subs?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: corsHeaders });

    const payload = JSON.stringify({ title, body, contact_id, url: url ?? '/inbox' });
    let sent = 0;

    for (const sub of subs) {
      try {
        const { body: encBody, headers: encHeaders } = await encryptPayload(payload, sub.p256dh, sub.auth);
        const vapidAuth = await buildVapidAuth(sub.endpoint);

        const resp = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            ...encHeaders,
            'Authorization': vapidAuth,
            'Content-Type': 'application/octet-stream',
            'TTL': '86400',
          },
          body: encBody,
        });

        if (resp.status === 410 || resp.status === 404) {
          // Subscription expired — clean up
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        } else if (resp.ok) {
          sent++;
        }
      } catch (e) {
        console.error('Push send error:', e);
      }
    }

    return new Response(JSON.stringify({ sent }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
