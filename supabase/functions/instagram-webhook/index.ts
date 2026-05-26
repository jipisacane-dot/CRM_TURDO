import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const VERIFY_TOKEN = Deno.env.get('IG_WEBHOOK_VERIFY_TOKEN') ?? 'turdo_crm_verify_2026';
const META_APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const FB_PAGE_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN') ?? '';
const MANYCHAT_KEY = Deno.env.get('MANYCHAT_API_KEY') ?? '';

// Resuelve nombre/username del usuario de IG desde su PSID.
// Mejora UX (los contactos dejan de aparecer como "Sin nombre") y habilita el
// lookup en ManyChat por nombre.
async function resolveIGProfile(psid: string): Promise<{ name: string | null; username: string | null }> {
  if (!FB_PAGE_TOKEN) return { name: null, username: null };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${psid}?fields=name,username&access_token=${FB_PAGE_TOKEN}`);
    if (!r.ok) return { name: null, username: null };
    const d = await r.json();
    return { name: d.name ?? null, username: d.username ?? null };
  } catch {
    return { name: null, username: null };
  }
}

// Busca el subscriber de ManyChat asociado al contacto IG. Estrategias:
//   1. findByName con el nombre real (si IG nos dio uno bueno)
//   2. findByName con el username
// Si encuentra match, devuelve el ManyChat subscriber id. La idea es linkear
// los contactos que ya pasaron por algún flow de IG (ManyChat los tiene como
// subscribers pero el CRM no sabía el ID). NO crea subscribers (ManyChat no
// expone API para crear IG subscribers, tienen que llegar via flow).
async function findManyChatIGSubscriber(name: string | null, username: string | null): Promise<string | null> {
  if (!MANYCHAT_KEY) return null;
  const candidates = [name, username].filter((s): s is string => !!s && s !== 'Sin nombre' && !/^\d+$/.test(s));
  for (const term of candidates) {
    try {
      const r = await fetch(
        `https://api.manychat.com/fb/subscriber/findByName?name=${encodeURIComponent(term)}`,
        { headers: { Authorization: `Bearer ${MANYCHAT_KEY}` } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const list = (j.data ?? []) as Array<Record<string, unknown>>;
      // Filtramos: solo subscribers que tienen IG real (no WSP ni Messenger).
      const igMatch = list.find(s => s.ig_username || s.ig_id);
      if (igMatch?.id) {
        return String(igMatch.id);
      }
    } catch (e) {
      console.warn('[IG] MC findByName err:', e);
    }
  }
  return null;
}

async function verifyMetaSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!META_APP_SECRET) {
    console.warn('META_APP_SECRET no configurado — saltando verificación HMAC');
    return true;
  }
  const sigHeader = req.headers.get('x-hub-signature-256');
  if (!sigHeader?.startsWith('sha256=')) return false;
  const expected = sigHeader.slice(7);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(META_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

interface IGAttachment {
  type?: string;
  payload?: { url?: string; sticker_id?: string };
}

// Descarga URL pública (sin auth, las URLs de IG attachments son temp signed URLs accesibles)
// y sube al bucket chat-media. Retorna URL pública del bucket.
async function storeFromUrl(url: string, contactId: string, msgId: string, kind: string): Promise<{ url: string; path: string; size: number; mime: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buffer = new Uint8Array(await resp.arrayBuffer());
    const mime = resp.headers.get('content-type') ?? 'application/octet-stream';
    const ext = mime.split('/')[1]?.split(';')[0] ?? 'bin';
    const path = `${contactId}/${msgId}_${kind}.${ext}`;
    const up = await supabase.storage.from('chat-media').upload(path, buffer, {
      contentType: mime,
      upsert: true,
    });
    if (up.error) {
      console.error('IG storage upload err', up.error);
      return null;
    }
    const { data: signed } = await supabase.storage.from('chat-media').createSignedUrl(path, 365 * 24 * 3600);
    return { url: signed?.signedUrl ?? '', path, size: buffer.length, mime };
  } catch (e) {
    console.error('storeFromUrl err', e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified');
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const sigOk = await verifyMetaSignature(req, rawBody);
  // FAIL-OPEN TEMPORAL hasta resolver HMAC con ManyChat suscripto
  console.log(`[IG-webhook] HMAC verify: ${sigOk ? 'OK' : 'MISMATCH'} (fail-open)`);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  console.log('IG webhook received:', JSON.stringify(body).slice(0, 500));

  const entries = (body.entry as unknown[]) ?? [];
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const messaging = (e.messaging as unknown[]) ?? [];

    for (const event of messaging) {
      const ev = event as Record<string, unknown>;
      const senderId = (ev.sender as Record<string, unknown>)?.id as string;
      const message = ev.message as Record<string, unknown> | null;
      const text = message?.text as string | null;
      const attachments = (message?.attachments as IGAttachment[] | undefined) ?? [];

      if (!senderId || message?.is_echo) continue;
      if (!text && attachments.length === 0) continue;

      // Resolver nombre/username real del IG (mejora UX). El profile fetch
      // puede fallar silenciosamente; en ese caso queda "Sin nombre".
      const profile = await resolveIGProfile(senderId);
      const resolvedName = profile.name ?? profile.username ?? 'Sin nombre';

      // Lookup-then-insert: si el mismo humano ya escribió por otro canal,
      // reutilizamos su contact_id (matchea por phone normalizado o email,
      // pero como IG no nos da phone/email del usuario, solo matchea por
      // channel_id de IG).
      const { data: contactIdRpc, error: contactError } = await supabase.rpc('find_or_create_contact', {
        p_channel: 'instagram',
        p_channel_id: senderId,
        p_name: resolvedName,
        p_phone: null,
        p_email: null,
        p_avatar_url: null,
        p_branch: 'Sucursal Centro',
      });

      if (contactError || !contactIdRpc) {
        console.error('find_or_create_contact err:', contactError);
        continue;
      }
      const contact = { id: contactIdRpc as string };

      // Auto-link a ManyChat: si el contacto no tiene manychat_subscriber_id
      // todavía, intentamos buscarlo por nombre. Solo lo hacemos para los IG
      // que ManyChat ya conoce (subscribers de flows previos). NO crea nuevos
      // subscribers — ManyChat no expone API para eso en IG.
      // Esto baja el fail rate de IG (75% hoy → ~30-40% una vez Meta aprueba
      // la capability instagram_manage_messages).
      try {
        const { data: c } = await supabase
          .from('contacts')
          .select('manychat_subscriber_id, name, ig_psid')
          .eq('id', contact.id)
          .single();
        const updates: Record<string, unknown> = {};
        // Si el contacto vino con "Sin nombre" pero ahora resolvimos uno, actualizamos
        if (resolvedName !== 'Sin nombre' && (!c?.name || c.name === 'Sin nombre')) {
          updates.name = resolvedName;
        }
        // Guardar el PSID en su columna dedicada (para futuras consultas)
        if (!c?.ig_psid) {
          updates.ig_psid = senderId;
        }
        if (!c?.manychat_subscriber_id) {
          const mcId = await findManyChatIGSubscriber(profile.name, profile.username);
          if (mcId) {
            updates.manychat_subscriber_id = mcId;
            console.log(`[IG] auto-linked ${contact.id} → MC ${mcId}`);
          }
        }
        if (Object.keys(updates).length > 0) {
          await supabase.from('contacts').update(updates).eq('id', contact.id);
        }
      } catch (e) {
        console.warn('[IG] auto-link err:', e);
      }

      const metaMid = (message?.mid as string) ?? `ig_${senderId}_${Date.now()}`;

      // Si el message tiene attachments multimedia, los procesamos uno a uno
      // pero los unimos en UNA fila si vienen juntos (caso típico)
      const firstAttachment = attachments[0];
      const isMedia = firstAttachment && ['image', 'video', 'audio', 'file', 'ig_reel'].includes(firstAttachment.type ?? '');

      const msgRecord: Record<string, unknown> = {
        contact_id: contact.id,
        direction: 'in',
        channel: 'instagram',
        meta_mid: metaMid,
        read: false,
      };

      if (isMedia && firstAttachment.payload?.url) {
        const kindRaw = firstAttachment.type as string;
        const kind = kindRaw === 'ig_reel' ? 'video' : kindRaw === 'file' ? 'document' : kindRaw;
        msgRecord.media_type = kind;
        msgRecord.content = text ?? `[${kind}]`;
        const stored = await storeFromUrl(firstAttachment.payload.url, contact.id, metaMid, kind);
        if (stored) {
          msgRecord.media_url = stored.url;
          msgRecord.media_path = stored.path;
          msgRecord.media_size_bytes = stored.size;
          msgRecord.media_mime = stored.mime;
        }
      } else {
        msgRecord.content = text ?? '';
      }

      await supabase.from('messages').upsert(msgRecord, { onConflict: 'meta_mid', ignoreDuplicates: true });

      const pushBody = isMedia
        ? `📎 ${firstAttachment.type === 'video' || firstAttachment.type === 'ig_reel' ? 'Video' : firstAttachment.type === 'image' ? 'Foto' : 'Archivo'}${text ? ': ' + text.slice(0, 60) : ''}`
        : (text ?? '').slice(0, 100);

      supabase.functions.invoke('send-push', {
        body: {
          title: contact.name ?? 'Instagram',
          body: pushBody,
          contact_id: contact.id,
          url: '/inbox',
          agent_id: (contact as Record<string, unknown>).assigned_to ?? undefined,
        },
      }).catch(console.error);

      supabase.functions.invoke('classify-message-stage', {
        body: { contact_id: contact.id },
      }).catch(console.error);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
