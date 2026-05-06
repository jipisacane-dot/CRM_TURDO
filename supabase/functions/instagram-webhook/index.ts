import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const VERIFY_TOKEN = Deno.env.get('IG_WEBHOOK_VERIFY_TOKEN') ?? 'turdo_crm_verify_2026';

interface IGAttachment {
  type?: string;
  payload?: { url?: string; sticker_id?: string };
}

// Descarga URL pública (sin auth, las URLs de IG attachments son temp signed URLs accesibles)
// y sube al bucket chat-media. Retorna URL pública del bucket.
async function storeFromUrl(url: string, contactId: string, msgId: string, kind: string): Promise<{ url: string; size: number; mime: string } | null> {
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
    const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(path);
    return { url: pub.publicUrl, size: buffer.length, mime };
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
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

      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .upsert(
          {
            channel_id: senderId,
            channel: 'instagram',
            name: 'Sin nombre',
            status: 'new',
            branch: 'Sucursal Centro',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'channel_id,channel', ignoreDuplicates: false }
        )
        .select()
        .single();

      if (contactError) {
        console.error('Contact upsert error:', contactError);
        continue;
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
