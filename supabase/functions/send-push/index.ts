import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Librería oficial de web-push para Deno. Implementa correctamente aes128gcm
// + VAPID + tag de GCM + record size. Reemplaza la implementación manual que
// teníamos (que tenía sutiles bugs de byte format que iOS no perdonaba).
import webpush from 'npm:web-push@3.6.7';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:turdoleticia@gmail.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// CORS lockdown: solo origenes permitidos.
const ALLOWED_ORIGINS = [
  'https://crm-turdo.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];
const isPreviewVercel = (o: string) =>
  /^https:\/\/crm-turdo-[a-z0-9]+-jipisacane-5891s-projects\.vercel\.app$/.test(o);

function buildCors(req: Request): Record<string, string> | null {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || isPreviewVercel(origin);
  if (!allowed) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// ── VAPID helpers (manual implementation for Deno) ────────────────────────────

async function importVapidKey(base64: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, usage);
}

// Convierte un Uint8Array a base64url (sin padding) — para usar en JWK
function bytesToB64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function b64UrlToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function signVapid(header: string, payload: string, privateKeyB64: string): Promise<string> {
  // VAPID private key viene en formato raw (32 bytes), NO PKCS#8. Para usarla
  // con WebCrypto ECDSA hay que construir un JWK con el privado + el público
  // (que extraemos de VAPID_PUBLIC_KEY: 65 bytes uncompressed = 0x04 || X || Y).
  const privateBytes = b64UrlToBytes(privateKeyB64);
  if (privateBytes.length !== 32) {
    throw new Error(`VAPID private key debe ser 32 bytes (es ${privateBytes.length})`);
  }
  const publicBytes = b64UrlToBytes(VAPID_PUBLIC);
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error(`VAPID public key debe ser 65 bytes uncompressed (0x04|X|Y), es ${publicBytes.length}`);
  }
  const x = publicBytes.slice(1, 33);
  const y = publicBytes.slice(33, 65);

  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64Url(x),
    y: bytesToB64Url(y),
    d: bytesToB64Url(privateBytes),
    ext: true,
  };

  const key = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return bytesToB64Url(new Uint8Array(sig));
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

// Encripta el payload usando aes128gcm (RFC 8291) — el formato moderno que
// iOS Safari requiere obligatorio. El formato anterior (aesgcm RFC 7515) lo
// acepta Apple en su servidor (devuelve 201) pero iOS lo descarta silencioso.
// Esta es la implementación correcta.
async function encryptPayload(
  payload: string,
  p256dhB64: string,
  authB64: string,
): Promise<{ body: Uint8Array; headers: Record<string, string> }> {
  const enc = new TextEncoder();
  const authBytes = b64UrlToBytes(authB64);

  // Server ephemeral keypair
  const serverKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const serverPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));

  // Client public key
  const clientPublicRaw = b64UrlToBytes(p256dhB64);
  const clientPublicKey = await crypto.subtle.importKey(
    'raw', clientPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // ECDH shared secret
  const sharedBits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: clientPublicKey }, serverKeys.privateKey, 256
    )
  );

  // Random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Step 1: IKM = HKDF-Expand(HKDF-Extract(auth_secret, ecdh_secret), info_ikm, 32)
  // info_ikm = "WebPush: info\0" || ua_public || as_public
  const sharedKey = await crypto.subtle.importKey('raw', sharedBits, { name: 'HKDF' }, false, ['deriveBits']);
  const ikmInfo = new Uint8Array([
    ...enc.encode('WebPush: info\0'),
    ...clientPublicRaw,
    ...serverPublicRaw,
  ]);
  const ikm = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authBytes, info: ikmInfo },
    sharedKey, 256
  );
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);

  // Step 2: CEK = HKDF-Expand(HKDF-Extract(salt, IKM), "Content-Encoding: aes128gcm\0", 16)
  const cekInfo = enc.encode('Content-Encoding: aes128gcm\0');
  const cek = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo },
    ikmKey, 128
  );

  // Step 3: nonce = HKDF-Expand(HKDF-Extract(salt, IKM), "Content-Encoding: nonce\0", 12)
  const nonceInfo = enc.encode('Content-Encoding: nonce\0');
  const nonce = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo },
    ikmKey, 96
  );

  // Step 4: pad + encrypt. RFC 8291: el último record termina con 0x02 (padding delimiter).
  const payloadBytes = enc.encode(payload);
  const plaintext = new Uint8Array(payloadBytes.length + 1);
  plaintext.set(payloadBytes);
  plaintext[payloadBytes.length] = 0x02;

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(nonce), tagLength: 128 },
      aesKey, plaintext
    )
  );

  // Step 5: armar body = salt(16) || record_size(4 BE) || idlen(1) || keyid(65) || encrypted
  const recordSize = Math.max(encrypted.length + 18, 18); // mínimo + tag
  const body = new Uint8Array(16 + 4 + 1 + 65 + encrypted.length);
  let offset = 0;
  body.set(salt, offset); offset += 16;
  new DataView(body.buffer, body.byteOffset).setUint32(offset, recordSize, false);
  offset += 4;
  body[offset++] = 65; // keyid length = P-256 uncompressed = 65 bytes
  body.set(serverPublicRaw, offset); offset += 65;
  body.set(encrypted, offset);

  // aes128gcm NO usa Encryption ni Crypto-Key headers (todo va en el body)
  return {
    body,
    headers: { 'Content-Encoding': 'aes128gcm' },
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (!cors) return new Response('Forbidden origin', { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { title, body, contact_id, url, agent_id } = await req.json() as {
      title: string; body: string; contact_id?: string; url?: string; agent_id?: string;
    };

    let query = supabase.from('push_subscriptions').select('*');
    if (agent_id) query = query.eq('agent_id', agent_id);
    const { data: subs } = await query;
    if (!subs?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: cors });

    const payload = JSON.stringify({ title, body, contact_id, url: url ?? '/inbox' });
    let sent = 0;
    const debug: Array<{ endpoint_host: string; status: number | string; error?: string; resp_body?: string }> = [];

    for (const sub of subs) {
      const endpoint_host = (() => { try { return new URL(sub.endpoint).host; } catch { return '?'; } })();
      try {
        // Usamos la librería oficial web-push que implementa correctamente
        // aes128gcm + VAPID JWT + record format. Reemplaza nuestra impl manual
        // que tenía bugs sutiles que iOS no perdonaba.
        const result = await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          {
            TTL: 86400,
            urgency: 'high',
            contentEncoding: 'aes128gcm',
          }
        );
        debug.push({ endpoint_host, status: result.statusCode });
        sent++;
      } catch (e: unknown) {
        const err = e as { statusCode?: number; body?: string; message?: string };
        const status = err.statusCode ?? 'EXCEPTION';
        if (status === 410 || status === 404) {
          // Subscription expired — clean up
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
        debug.push({
          endpoint_host,
          status,
          error: err.message?.slice(0, 200),
          resp_body: err.body?.slice(0, 300),
        });
        console.error('[push] send fail:', err);
      }
    }

    return new Response(JSON.stringify({ sent, total: subs.length, debug }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
