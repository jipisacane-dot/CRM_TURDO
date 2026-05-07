import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const VERIFY_TOKEN = Deno.env.get('WA_WEBHOOK_VERIFY_TOKEN') ?? 'turdo_crm_wa_2026';
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? Deno.env.get('FB_PAGE_ACCESS_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

// Tipos de media de WhatsApp Cloud → categoría que guardamos en messages.media_type
const WA_MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker', 'voice'] as const;

interface WAMedia {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
  sha256?: string;
}

// Descarga la media de Meta (con auth) y la sube al bucket chat-media. Retorna URL pública.
async function downloadAndStore(mediaId: string, contactId: string, msgId: string, mime: string, originalName?: string): Promise<{ url: string; size: number; filename: string } | null> {
  try {
    // 1. Get URL temporal de Meta
    const metaResp = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` },
    });
    if (!metaResp.ok) {
      console.error('Meta media meta fetch failed', mediaId, await metaResp.text());
      return null;
    }
    const metaJson = await metaResp.json();
    const tempUrl = metaJson.url as string;
    if (!tempUrl) return null;

    // 2. Descargar binary con auth
    const binResp = await fetch(tempUrl, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` },
    });
    if (!binResp.ok) {
      console.error('Meta media binary fetch failed', mediaId, binResp.status);
      return null;
    }
    const buffer = new Uint8Array(await binResp.arrayBuffer());

    // 3. Subir al bucket
    const ext = mime.split('/')[1]?.split(';')[0] ?? 'bin';
    const filename = originalName || `${mediaId}.${ext}`;
    const path = `${contactId}/${msgId}_${filename}`.replace(/[^a-zA-Z0-9._\-/]/g, '_');

    const uploadResp = await supabase.storage.from('chat-media').upload(path, buffer, {
      contentType: mime,
      upsert: true,
    });
    if (uploadResp.error) {
      console.error('Storage upload err', uploadResp.error);
      return null;
    }

    const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(path);
    return { url: pub.publicUrl, size: buffer.length, filename };
  } catch (e) {
    console.error('downloadAndStore err', e);
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
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  console.log('WA webhook:', JSON.stringify(body).slice(0, 500));

  const entries = (body.entry as unknown[]) ?? [];
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const changes = (e.changes as unknown[]) ?? [];
    for (const change of changes) {
      const c = change as Record<string, unknown>;
      if ((c.field as string) !== 'messages') continue;
      const value = c.value as Record<string, unknown>;
      const messages = (value.messages as unknown[]) ?? [];
      const waContacts = (value.contacts as unknown[]) ?? [];

      for (const message of messages) {
        const m = message as Record<string, unknown>;
        const from = m.from as string;
        const msgId = m.id as string;
        const type = m.type as string;

        if (!from || !msgId) continue;

        // Detectar text vs media
        const text = (m.text as Record<string, unknown>)?.body as string | null;
        const mediaPayload = WA_MEDIA_TYPES.includes(type as typeof WA_MEDIA_TYPES[number])
          ? (m[type] as WAMedia | undefined)
          : null;

        if (!text && !mediaPayload) continue;

        const phone = `+${from.replace(/\D/g, '')}`;
        const contactInfo = waContacts.find((ct: unknown) =>
          (ct as Record<string, unknown>).wa_id === from
        ) as Record<string, unknown> | undefined;
        const name = (contactInfo?.profile as Record<string, unknown>)?.name as string || phone;

        const { data: existing } = await supabase
          .from('contacts')
          .select('id, name')
          .eq('channel', 'whatsapp')
          .eq('phone', phone)
          .maybeSingle();

        let contactId: string;
        if (existing) {
          contactId = existing.id;
          if (existing.name === 'Sin nombre' || existing.name === phone) {
            await supabase.from('contacts').update({ name, updated_at: new Date().toISOString() }).eq('id', contactId);
          }
        } else {
          const { data: newContact, error: insertErr } = await supabase
            .from('contacts')
            .insert({ channel: 'whatsapp', phone, name, status: 'new', branch: 'Sucursal Centro' })
            .select('id')
            .single();
          if (insertErr || !newContact) { console.error('Insert error:', insertErr); continue; }
          contactId = newContact.id;
        }

        // Construir el record de mensaje
        const msgRecord: Record<string, unknown> = {
          contact_id: contactId,
          direction: 'in',
          channel: 'whatsapp',
          meta_mid: msgId,
          read: false,
        };

        if (mediaPayload) {
          // Categorizar: voice y sticker → audio/sticker como type, pero el media_type en DB lo simplificamos
          const mediaCategory = type === 'voice' ? 'audio' : type;
          msgRecord.media_type = mediaCategory;
          msgRecord.media_caption = mediaPayload.caption ?? null;
          msgRecord.media_mime = mediaPayload.mime_type ?? null;
          msgRecord.media_filename = mediaPayload.filename ?? null;
          msgRecord.content = mediaPayload.caption ?? `[${mediaCategory}]`;

          // Descargar y subir a storage
          if (mediaPayload.id) {
            const stored = await downloadAndStore(
              mediaPayload.id,
              contactId,
              msgId,
              mediaPayload.mime_type ?? 'application/octet-stream',
              mediaPayload.filename
            );
            if (stored) {
              msgRecord.media_url = stored.url;
              msgRecord.media_size_bytes = stored.size;
              if (!msgRecord.media_filename) msgRecord.media_filename = stored.filename;
            }
          }
        } else if (text) {
          msgRecord.content = text;
        }

        await supabase.from('messages').upsert(msgRecord, { onConflict: 'meta_mid', ignoreDuplicates: true });

        const { data: fullContact } = await supabase.from('contacts').select('assigned_to').eq('id', contactId).single();
        const pushBody = mediaPayload
          ? `📎 ${type === 'image' ? 'Foto' : type === 'video' ? 'Video' : type === 'audio' || type === 'voice' ? 'Audio' : type === 'document' ? 'Documento' : 'Archivo'}${mediaPayload.caption ? ': ' + mediaPayload.caption.slice(0, 60) : ''}`
          : (text ?? '').slice(0, 100);

        supabase.functions.invoke('send-push', {
          body: { title: name, body: pushBody, contact_id: contactId, url: '/inbox', agent_id: fullContact?.assigned_to ?? undefined },
        }).catch(console.error);

        supabase.functions.invoke('classify-message-stage', {
          body: { contact_id: contactId },
        }).catch(console.error);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

// Touch SUPABASE_URL para que el linter no se queje (lo usamos indirecto via createClient)
void SUPABASE_URL;
