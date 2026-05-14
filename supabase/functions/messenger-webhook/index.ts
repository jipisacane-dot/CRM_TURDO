// Webhook de Facebook Messenger Page → CRM Turdo
// Recibe DMs y comments de la página de Facebook y los inserta como contacts + messages.
// El outbound (responder desde el CRM) lo maneja send-message vía /me/messages.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const VERIFY_TOKEN = Deno.env.get('FB_WEBHOOK_VERIFY_TOKEN') ?? 'turdo_crm_verify_2026';
const FB_PAGE_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN') ?? '';
const META_APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';

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

interface FBAttachment {
  type?: string;
  payload?: { url?: string; sticker_id?: string };
}

// Descarga URL pública (Meta CDN signed URL temp) y sube al bucket chat-media.
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
    if (up.error) return null;
    const { data: signed } = await supabase.storage.from('chat-media').createSignedUrl(path, 365 * 24 * 3600);
    return { url: signed?.signedUrl ?? '', path, size: buffer.length, mime };
  } catch {
    return null;
  }
}

// Resuelve nombre del usuario de Messenger desde su PSID (page-scoped ID)
async function resolveProfileName(psid: string): Promise<string | null> {
  if (!FB_PAGE_TOKEN) return null;
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${psid}?fields=name&access_token=${FB_PAGE_TOKEN}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d.name ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  // ── GET = verificación de webhook (Meta hace handshake) ──
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[messenger-webhook] verified');
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();
  const sigOk = await verifyMetaSignature(req, rawBody);
  if (!sigOk) {
    console.warn('Messenger webhook: firma HMAC inválida, rechazando');
    return new Response('Invalid signature', { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400 }); }

  console.log('[messenger-webhook] event:', JSON.stringify(body).slice(0, 600));

  const object = body.object as string | undefined;
  if (object !== 'page') {
    // No-op para otros tipos de objeto. Seguimos respondiendo 200 para que Meta no retry.
    return new Response('ok', { status: 200 });
  }

  const entries = (body.entry as unknown[]) ?? [];

  for (const entry of entries) {
    const e = entry as Record<string, unknown>;

    // ── EVENTO 1: DMs Messenger ──────────────────────────────
    const messaging = (e.messaging as unknown[]) ?? [];
    for (const event of messaging) {
      const ev = event as Record<string, unknown>;
      const senderId = (ev.sender as Record<string, unknown>)?.id as string;
      const message = ev.message as Record<string, unknown> | null;
      if (!senderId || message?.is_echo) continue;
      const text = message?.text as string | null;
      const attachments = (message?.attachments as FBAttachment[] | undefined) ?? [];
      if (!text && attachments.length === 0) continue;

      // Resolve profile name (mejora UX, no crítico)
      const name = await resolveProfileName(senderId) ?? 'Sin nombre';

      const { data: contactIdRpc, error: contactError } = await supabase.rpc('find_or_create_contact', {
        p_channel: 'facebook',
        p_channel_id: senderId,
        p_name: name,
        p_phone: null,
        p_email: null,
        p_avatar_url: null,
        p_branch: 'Sucursal Centro',
      });

      if (contactError || !contactIdRpc) {
        console.error('[messenger-webhook] find_or_create_contact err:', contactError);
        continue;
      }

      const metaMid = (message?.mid as string) ?? `fb_${senderId}_${Date.now()}`;
      const firstAttachment = attachments[0];
      const isMedia = firstAttachment && ['image', 'video', 'audio', 'file'].includes(firstAttachment.type ?? '');

      const msgRecord: Record<string, unknown> = {
        contact_id: (contactIdRpc as string),
        direction: 'in',
        channel: 'facebook',
        meta_mid: metaMid,
        read: false,
      };

      if (isMedia && firstAttachment.payload?.url) {
        const kind = firstAttachment.type as string;
        msgRecord.media_type = kind;
        msgRecord.content = text ?? `[${kind}]`;
        const stored = await storeFromUrl(firstAttachment.payload.url, (contactIdRpc as string), metaMid, kind);
        if (stored) {
          msgRecord.media_url = stored.url;
          msgRecord.media_path = stored.path;
          msgRecord.media_size_bytes = stored.size;
          msgRecord.media_mime = stored.mime;
        }
      } else {
        msgRecord.content = text ?? '';
      }

      const { error: msgError } = await supabase.from('messages').insert(msgRecord);
      if (msgError && msgError.code !== '23505') {
        console.error('[messenger-webhook] msg insert err:', msgError);
      }

      // Pipeline auto-classify (fire-and-forget)
      supabase.functions.invoke('classify-message-stage', {
        body: { contact_id: (contactIdRpc as string), message_text: text, channel: 'facebook' },
      }).catch(() => {});
    }

    // ── EVENTO 2: Comments en posts de la Page ───────────────
    const changes = (e.changes as unknown[]) ?? [];
    for (const change of changes) {
      const c = change as Record<string, unknown>;
      if (c.field !== 'feed') continue;
      const value = c.value as Record<string, unknown>;
      if (value.item !== 'comment' || value.verb !== 'add') continue;

      const fromId = ((value.from as Record<string, unknown>)?.id as string) ?? '';
      const fromName = ((value.from as Record<string, unknown>)?.name as string) ?? 'Comentarista FB';
      const commentText = (value.message as string) ?? '';
      const commentId = (value.comment_id as string) ?? `fb_comment_${Date.now()}`;
      const postId = (value.post_id as string) ?? '';

      if (!fromId || !commentText) continue;

      const { data: commentContactId } = await supabase.rpc('find_or_create_contact', {
        p_channel: 'facebook',
        p_channel_id: fromId,
        p_name: fromName,
        p_phone: null,
        p_email: null,
        p_avatar_url: null,
        p_branch: 'Sucursal Centro',
      });

      if (!commentContactId) continue;

      await supabase.from('messages').insert({
        contact_id: commentContactId as string,
        direction: 'in',
        channel: 'facebook',
        meta_mid: commentId,
        content: `💬 Comentario en post: ${commentText}`,
        read: false,
        media_type: 'comment',
        media_caption: postId,
      });
    }
  }

  return new Response('ok', { status: 200 });
});
