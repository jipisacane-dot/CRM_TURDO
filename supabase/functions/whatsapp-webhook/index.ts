import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const VERIFY_TOKEN = Deno.env.get('WA_WEBHOOK_VERIFY_TOKEN') ?? 'turdo_crm_wa_2026';
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? Deno.env.get('FB_PAGE_ACCESS_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const META_APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const MANYCHAT_KEY = Deno.env.get('MANYCHAT_API_KEY') ?? '';

// Busca un subscriber en ManyChat que tenga `whatsapp_phone` matcheando el
// número del contacto. ManyChat crea subscribers automáticamente cuando llega
// un mensaje que dispara una automatización con keyword. Pero CRÍTICO: tener
// una flow disparándose con WhatsApp inbound hace que ManyChat ack-ee cada
// mensaje (status: read) y le clave el visto al cliente. Por eso la flow
// "Whatsapp Default Reply" debe quedar PAUSADA. Sin la flow no hay subscriber
// auto-creado, entonces:
//   1. Intentamos findByName (puede que ManyChat aún lo tenga shadow-trackeado)
//   2. Si no existe, lo creamos vía createSubscriber API directamente. Así
//      tenemos subscriber_id para que send-message use ManyChat sendContent.
async function findOrCreateManyChatSubscriber(
  phone: string,
  name: string,
): Promise<string | null> {
  if (!MANYCHAT_KEY) return null;
  // Normalizar a formato +5491138113962
  const normalizedPhone = phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`;

  // Estrategia 1: buscar por nombre (lo más rápido si tenemos uno bueno)
  if (name && name !== 'Sin nombre' && !/^\+?\d+$/.test(name)) {
    try {
      const r = await fetch(
        `https://api.manychat.com/fb/subscriber/findByName?name=${encodeURIComponent(name)}`,
        { headers: { Authorization: `Bearer ${MANYCHAT_KEY}` } }
      );
      if (r.ok) {
        const j = await r.json();
        const match = (j.data ?? []).find((s: Record<string, unknown>) => s.whatsapp_phone === normalizedPhone);
        if (match?.id) return String(match.id);
      }
    } catch (e) {
      console.warn('MC findByName err:', e);
    }
  }

  // Estrategia 2: crear el subscriber vía Phone Import API. Requiere que
  // "Phone Import" esté habilitado en la cuenta de ManyChat (ya está pedido
  // y aprobado). Si el wa_id ya existe, ManyChat devuelve "already exists" —
  // en ese caso significa que está en otra cuenta o con otro nombre, no
  // podemos linkearlo desde acá. Retornamos null y send-message cae al
  // fallback de Cloud API.
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0] && parts[0] !== 'Sin' ? parts[0] : 'Contacto';
  const lastName = parts.length > 1 && parts[0] !== 'Sin' ? parts.slice(1).join(' ') : '-';
  try {
    const r = await fetch('https://api.manychat.com/fb/subscriber/createSubscriber', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MANYCHAT_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        whatsapp_phone: normalizedPhone,
        first_name: firstName,
        last_name: lastName,
        has_opt_in_sms: false,
        has_opt_in_email: false,
        consent_phrase: 'Contact opted in by sending WhatsApp message to business.',
      }),
    });
    const raw = await r.text();
    let j: Record<string, unknown>;
    try { j = JSON.parse(raw); } catch { return null; }
    if (r.ok && j.status === 'success') {
      const id = (j.data as Record<string, unknown> | undefined)?.id;
      if (id) {
        console.log(`[WA] createSubscriber OK ${normalizedPhone} → ${id}`);
        return String(id);
      }
    } else {
      console.log(`[WA] createSubscriber failed for ${normalizedPhone}: ${raw.slice(0, 200)}`);
    }
  } catch (e) {
    console.warn('[WA] createSubscriber err:', e);
  }
  return null;
}

// Valida firma HMAC-SHA256 que Meta envía en x-hub-signature-256.
// Si META_APP_SECRET no está configurado, pasa con warning (modo gracia
// hasta confirmar el secret correcto en Meta Developers → App Settings → Basic).
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
async function downloadAndStore(mediaId: string, contactId: string, msgId: string, mime: string, originalName?: string): Promise<{ url: string; path: string; size: number; filename: string } | null> {
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

    // Bucket es privado: generamos signed URL temporal (1 año, para que la URL guardada en
    // messages.media_url sirva al menos como fallback). El frontend prefiere media_path
    // y regenera signed URL fresca al renderizar.
    const { data: signed } = await supabase.storage.from('chat-media').createSignedUrl(path, 365 * 24 * 3600);
    return { url: signed?.signedUrl ?? '', path, size: buffer.length, filename };
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

  // Leer body como text primero para verificar HMAC (no se puede re-leer el stream)
  const rawBody = await req.text();
  const sigOk = await verifyMetaSignature(req, rawBody);
  // FAIL-OPEN TEMPORAL: loguear pero no rechazar. ManyChat se suscribió al WABA y
  // está rompiendo la firma HMAC original (probablemente porque Meta firma con otro
  // app_secret cuando hay multiples subscribed_apps). Investigar y volver a fail-closed.
  console.log(`[WA-webhook] HMAC verify: ${sigOk ? 'OK' : 'MISMATCH'} (fail-open mode)`);

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  console.log('WA webhook:', JSON.stringify(body).slice(0, 500));

  const entries = (body.entry as unknown[]) ?? [];
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const changes = (e.changes as unknown[]) ?? [];
    for (const change of changes) {
      const c = change as Record<string, unknown>;
      const field = c.field as string;

      // ── ECHO de mensajes salientes ────────────────────────────────────────────
      // Cuando el número está en modo Coexistence, Meta manda webhook field
      // `message_echoes` con los mensajes enviados desde la app de WhatsApp
      // Business. Los registramos como direction='out' sin agent_id para
      // que aparezcan en el chat del CRM.
      if (field === 'message_echoes') {
        const value = c.value as Record<string, unknown>;
        const echoes = (value.message_echoes as unknown[]) ?? (value.messages as unknown[]) ?? [];
        for (const echo of echoes) {
          const m = echo as Record<string, unknown>;
          const to = m.to as string;
          const msgId = m.id as string;
          const type = (m.type as string) ?? 'text';
          if (!to || !msgId) continue;

          const text = (m.text as Record<string, unknown>)?.body as string | null;
          const mediaPayload = WA_MEDIA_TYPES.includes(type as typeof WA_MEDIA_TYPES[number])
            ? (m[type] as WAMedia | undefined)
            : null;
          if (!text && !mediaPayload) continue;

          const phone = `+${to.replace(/\D/g, '')}`;
          const { data: contactIdRpc } = await supabase.rpc('find_or_create_contact', {
            p_channel: 'whatsapp',
            p_channel_id: to,
            p_name: phone,
            p_phone: phone,
            p_email: null,
            p_avatar_url: null,
            p_branch: 'Corrientes',
          });
          if (!contactIdRpc) continue;

          const msgRecord: Record<string, unknown> = {
            contact_id: contactIdRpc as string,
            direction: 'out',
            channel: 'whatsapp',
            meta_mid: msgId,
            read: true, // los out no son "no leídos" para nadie
          };

          if (mediaPayload) {
            const mediaCategory = type === 'voice' ? 'audio' : type;
            msgRecord.media_type = mediaCategory;
            msgRecord.media_caption = mediaPayload.caption ?? null;
            msgRecord.media_mime = mediaPayload.mime_type ?? null;
            msgRecord.content = mediaPayload.caption ?? `[${mediaCategory}]`;
            if (mediaPayload.id) {
              const stored = await downloadAndStore(
                mediaPayload.id, contactIdRpc as string, msgId,
                mediaPayload.mime_type ?? 'application/octet-stream',
                mediaPayload.filename
              );
              if (stored) {
                msgRecord.media_url = stored.url;
                msgRecord.media_path = stored.path;
                msgRecord.media_size_bytes = stored.size;
              }
            }
          } else if (text) {
            msgRecord.content = text;
          }

          await supabase.from('messages').upsert(msgRecord, { onConflict: 'meta_mid', ignoreDuplicates: true });
        }
        continue;
      }

      if (field !== 'messages') continue;
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

        // Lookup-then-insert atómico vía RPC: matchea por channel_id, phone normalizado
        // o email. Si encuentra contact existente del mismo humano (aunque sea por otro
        // canal), reutiliza ese contact_id en lugar de duplicarlo.
        const { data: contactIdRpc, error: rpcErr } = await supabase.rpc('find_or_create_contact', {
          p_channel: 'whatsapp',
          p_channel_id: from,
          p_name: name,
          p_phone: phone,
          p_email: null,
          p_avatar_url: null,
          p_branch: 'Corrientes',
        });
        if (rpcErr || !contactIdRpc) { console.error('find_or_create_contact err:', rpcErr); continue; }
        const contactId: string = contactIdRpc as string;

        // Linkear con ManyChat. La flow "Whatsapp Default Reply" debe estar
        // PAUSADA (sino ManyChat ack-ea y mete visto al cliente). Sin la flow,
        // ManyChat no auto-crea subscribers. Entonces probamos:
        //   1. findByName por si ManyChat lo tiene de antes
        //   2. createSubscriber vía Phone Import API si no existe
        // Esto reemplaza el retry largo de findByName (que dependía de que la
        // flow ejecutara).
        (async () => {
          const { data: existing } = await supabase
            .from('contacts').select('manychat_subscriber_id').eq('id', contactId).maybeSingle();
          if (existing?.manychat_subscriber_id) return;

          // Pequeño delay por si justo ManyChat estaba indexando el inbound
          await new Promise(r => setTimeout(r, 2000));
          const mcId = await findOrCreateManyChatSubscriber(phone, name);
          if (mcId) {
            await supabase.from('contacts').update({ manychat_subscriber_id: mcId }).eq('id', contactId);
            console.log(`[WA] linked contact ${contactId} → MC ${mcId}`);
          } else {
            console.log(`[WA] could not link ${contactId} in ManyChat (send-message caerá a Cloud API fallback)`);
          }
        })().catch(e => console.error('MC link err:', e));

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
              msgRecord.media_path = stored.path;
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
          body: {
            title: name,
            body: pushBody,
            contact_id: contactId,
            url: '/inbox',
            agent_id: fullContact?.assigned_to ?? undefined,
            // Admin (Leti) recibe todas las notifs aunque el contacto esté
            // asignado a otro vendedor — para supervisión en tiempo real.
            notify_admins: true,
          },
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
