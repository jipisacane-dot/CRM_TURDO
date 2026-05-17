import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FB_TOKEN           = Deno.env.get('FB_PAGE_ACCESS_TOKEN')!;
const WA_TOKEN           = Deno.env.get('WHATSAPP_TOKEN') ?? FB_TOKEN;
const IG_TOKEN           = FB_TOKEN; // Page token works for IG Business Messaging
const IG_BUSINESS_ID     = Deno.env.get('IG_BUSINESS_ACCOUNT_ID') ?? 'me';
const MANYCHAT_KEY       = Deno.env.get('MANYCHAT_API_KEY')!;
const WA_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

// Whitelist de orígenes permitidos. Bloquea curl directo sin Origin
// y browsers desde dominios no autorizados.
const ALLOWED_ORIGINS = [
  'https://crm-turdo.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];
const isPreviewVercel = (o: string) => /^https:\/\/crm-turdo-[a-z0-9]+-jipisacane-5891s-projects\.vercel\.app$/.test(o);

function buildCors(req: Request): Record<string, string> | null {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || isPreviewVercel(origin);
  if (!allowed) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
}

// ── WhatsApp Cloud API ────────────────────────────────────────────────────────
interface WAMediaArgs { url: string; type: 'image' | 'video' | 'audio' | 'document'; caption?: string; filename?: string }

async function sendWhatsApp(phone: string, text: string, media?: WAMediaArgs) {
  if (!WA_PHONE_NUMBER_ID) return { ok: false, error: 'WHATSAPP_PHONE_NUMBER_ID not set' };
  const to = phone.replace(/\D/g, '');

  let payload: Record<string, unknown>;
  if (media) {
    const mediaObj: Record<string, unknown> = { link: media.url };
    if (media.caption && (media.type === 'image' || media.type === 'video' || media.type === 'document')) {
      mediaObj.caption = media.caption;
    }
    if (media.type === 'document' && media.filename) mediaObj.filename = media.filename;
    payload = { messaging_product: 'whatsapp', to, type: media.type, [media.type]: mediaObj };
  } else {
    payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
  }

  const resp = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await resp.json();
  if (!resp.ok) {
    const code = result?.error?.code;
    return { ok: false, error: JSON.stringify(result), outsideWindow: code === 131047 || code === 130472 };
  }
  return { ok: true };
}

// ── Instagram Graph API ───────────────────────────────────────────────────────
interface MetaMediaArgs { url: string; type: 'image' | 'video' | 'audio' | 'document' | 'file' }

function buildMessagePayload(text: string, media?: MetaMediaArgs): Record<string, unknown> {
  if (media) {
    const igType = media.type === 'document' ? 'file' : media.type;
    return {
      attachment: {
        type: igType,
        payload: { url: media.url, is_reusable: false },
      },
    };
  }
  return { text };
}

async function sendInstagram(psid: string, text: string, media?: MetaMediaArgs) {
  const resp = await fetch(`https://graph.facebook.com/v20.0/${IG_BUSINESS_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${IG_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      message: buildMessagePayload(text, media),
      messaging_type: 'RESPONSE',
    }),
  });
  const result = await resp.json();
  if (!resp.ok) return { ok: false, error: JSON.stringify(result) };
  return { ok: true };
}

// ── Facebook Page Messaging ───────────────────────────────────────────────────
async function sendFacebook(psid: string, text: string, media?: MetaMediaArgs) {
  const resp = await fetch('https://graph.facebook.com/v20.0/me/messages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${FB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      message: buildMessagePayload(text, media),
      messaging_type: 'RESPONSE',
    }),
  });
  const result = await resp.json();
  if (!resp.ok) return { ok: false, error: JSON.stringify(result) };
  return { ok: true };
}

const MANYCHAT_WA_FLOW_NS = Deno.env.get('MANYCHAT_WA_FLOW_NS') ?? '';
const MANYCHAT_WA_FIELD_ID = 14515582; // crm_reply custom field

// ── ManyChat WhatsApp via flow ────────────────────────────────────────────────
// sendContent checks Messenger last_interaction (null for WA-only subscribers).
// Workaround: set crm_reply field via setCustomField then trigger the WA reply flow.
async function sendManyChatWA(subscriberId: string, text: string): Promise<{ ok: boolean; error?: string; outsideWindow?: boolean }> {
  if (!MANYCHAT_WA_FLOW_NS) return { ok: false, error: 'MANYCHAT_WA_FLOW_NS not configured' };

  // Step 1: set the crm_reply custom field using setCustomField endpoint
  const setResp = await fetch('https://api.manychat.com/fb/subscriber/setCustomField', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_id: Number(subscriberId), field_id: MANYCHAT_WA_FIELD_ID, field_value: text }),
  });
  const rawSet = await setResp.text();
  let setResult: Record<string, unknown>;
  try { setResult = JSON.parse(rawSet); } catch { setResult = { status: 'error', message: rawSet.slice(0, 100) }; }
  console.log(`ManyChat setCustomField status=${setResp.status} body=${JSON.stringify(setResult)}`);
  if (!setResp.ok || setResult?.status !== 'success') {
    return { ok: false, error: `setField: ${setResult?.message ?? JSON.stringify(setResult)}` };
  }

  // Step 2: trigger the WA reply flow
  const flowResp = await fetch('https://api.manychat.com/fb/sending/sendFlow', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_id: Number(subscriberId), flow_ns: MANYCHAT_WA_FLOW_NS }),
  });
  const rawFlow = await flowResp.text();
  let flowResult: Record<string, unknown>;
  try { flowResult = JSON.parse(rawFlow); } catch { flowResult = { status: 'error', message: rawFlow.slice(0, 100) }; }
  console.log(`ManyChat sendFlow status=${flowResp.status} body=${JSON.stringify(flowResult)}`);
  if (flowResp.ok && flowResult?.status === 'success') return { ok: true };
  return { ok: false, error: `sendFlow: ${flowResult?.message ?? JSON.stringify(flowResult)}` };
}

// ── ManyChat sendContent (Messenger / Instagram) ──────────────────────────────
async function sendManyChat(subscriberId: string, text: string, mcChannel: 'ig' | 'fb' = 'fb'): Promise<{ ok: boolean; error?: string; outsideWindow?: boolean }> {
  // Try without tag first, then HUMAN_AGENT (7-day CRM window for Messenger)
  for (const tag of [null, 'HUMAN_AGENT']) {
    const body: Record<string, unknown> = {
      subscriber_id: Number(subscriberId),
      data: { version: 'v2', content: { messages: [{ type: 'text', text }] } },
    };
    if (tag) body.message_tag = tag;

    const resp = await fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await resp.json();
    console.log(`ManyChat sendContent ch=${mcChannel} tag=${tag ?? 'none'} status=${resp.status} body=${JSON.stringify(result)}`);
    if (resp.ok && result?.status === 'success') return { ok: true };

    const fullJson = JSON.stringify(result).toLowerCase();
    const isWindowError = fullJson.includes('message tag') || fullJson.includes('24 hour') || fullJson.includes('23h ago') || fullJson.includes('outside window') || fullJson.includes('session expired');
    const msg = result?.message ? `${result.message} [full:${JSON.stringify(result)}]` : JSON.stringify(result);
    if (!isWindowError) return { ok: false, error: msg, outsideWindow: false };
    if (tag === 'HUMAN_AGENT') return { ok: false, error: msg, outsideWindow: true };
  }
  return { ok: false, error: 'unknown', outsideWindow: false };
}

// ── ManyChat subscriber lookup (gets ig_id = Instagram PSID) ─────────────────
async function getMCSubscriber(mcId: string): Promise<{ ig_id?: string; whatsapp_phone?: string } | null> {
  try {
    const resp = await fetch(
      `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${mcId}`,
      { headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}` } }
    );
    if (!resp.ok) return null;
    const json = await resp.json();
    const data = json?.data;
    if (!data) return null;
    return {
      ig_id: data.ig_id ? String(data.ig_id) : undefined,
      whatsapp_phone: data.whatsapp_phone ?? undefined,
    };
  } catch { return null; }
}

// ── Main ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (!cors) return new Response('Forbidden origin', { status: 403 });
  try {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  let body: {
    contact_id: string; content: string; agent_id?: string;
    media_type?: 'image' | 'video' | 'audio' | 'document';
    media_url?: string; media_path?: string; media_caption?: string; media_mime?: string;
    media_filename?: string; media_size_bytes?: number;
  };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: cors }); }

  const { contact_id, content, agent_id, media_type, media_url, media_path, media_caption, media_mime, media_filename, media_size_bytes } = body;
  if (!contact_id || (!content && !media_url))
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: cors });

  const isMedia = !!(media_type && media_url);

  const { data: contact, error: ce } = await supabase
    .from('contacts').select('*').eq('id', contact_id).single();
  if (ce || !contact)
    return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404, headers: cors });

  // Always save message to DB first (including media metadata)
  const { data: msg, error: me } = await supabase.from('messages').insert({
    contact_id, direction: 'out', content,
    channel: contact.channel, meta_mid: null,
    agent_id: agent_id ?? null, read: true,
    media_type: media_type ?? null,
    media_url: media_url ?? null,
    media_path: media_path ?? null,
    media_caption: media_caption ?? null,
    media_mime: media_mime ?? null,
    media_filename: media_filename ?? null,
    media_size_bytes: media_size_bytes ?? null,
  }).select().single();
  if (me) return new Response(JSON.stringify({ error: me.message }), { status: 500, headers: cors });

  let method = 'none', ok = false, errDetail = '', outsideWindow = false;

  const waMedia: WAMediaArgs | undefined = isMedia
    ? { url: media_url!, type: media_type!, caption: media_caption, filename: media_filename }
    : undefined;
  const metaMedia: MetaMediaArgs | undefined = isMedia
    ? { url: media_url!, type: media_type as MetaMediaArgs['type'] }
    : undefined;

  // ── WhatsApp ────────────────────────────────────────────────────────────────
  if (contact.channel === 'whatsapp') {
    let phone = (contact.phone as string | null) ?? '';

    // Lookup phone from ManyChat if missing
    if (!phone && contact.channel_id) {
      const sub = await getMCSubscriber(contact.channel_id);
      phone = sub?.whatsapp_phone ?? '';
      if (phone) await supabase.from('contacts').update({ phone }).eq('id', contact_id);
    }

    // WhatsApp: ManyChat primero (flow probado), Cloud API fallback.
    // Si hay media → Cloud API directo (ManyChat no soporta media bien).
    if (waMedia) {
      if (!phone || !WA_PHONE_NUMBER_ID) {
        method = 'failed';
        errDetail = 'no_phone_for_media';
      } else {
        const r = await sendWhatsApp(phone, content, waMedia);
        if (r.ok) { method = 'whatsapp_cloud'; ok = true; }
        else { errDetail = r.error ?? ''; outsideWindow = r.outsideWindow ?? false; }
      }
    } else if (contact.channel_id) {
      const r = await sendManyChatWA(contact.channel_id, content);
      if (r.ok) { method = 'manychat'; ok = true; }
      else {
        errDetail = `mc: ${r.error}`;
        // Fallback Cloud API
        if (phone && WA_PHONE_NUMBER_ID) {
          const r2 = await sendWhatsApp(phone, content);
          if (r2.ok) { method = 'whatsapp_cloud'; ok = true; }
          else {
            outsideWindow = r.outsideWindow ?? false;
            errDetail += ` | wa: ${r2.error}`;
          }
        } else {
          outsideWindow = r.outsideWindow ?? false;
        }
      }
    } else if (phone && WA_PHONE_NUMBER_ID) {
      const r = await sendWhatsApp(phone, content);
      if (r.ok) { method = 'whatsapp_cloud'; ok = true; }
      else { outsideWindow = r.outsideWindow ?? false; errDetail = r.error ?? ''; }
    }

  // ── Instagram ───────────────────────────────────────────────────────────────
  } else if (contact.channel === 'instagram') {
    // Resolve IGSID: use stored ig_psid, else lookup from ManyChat, else use channel_id if long
    let igPsid = (contact.ig_psid as string | null) ?? null;

    if (!igPsid && contact.channel_id) {
      // If channel_id looks like a real PSID (long number), use it directly
      if (contact.channel_id.length > 12 && /^\d+$/.test(contact.channel_id)) {
        igPsid = contact.channel_id;
        await supabase.from('contacts').update({ ig_psid: igPsid }).eq('id', contact_id);
      } else {
        // ManyChat subscriber: get ig_id (Instagram PSID)
        const sub = await getMCSubscriber(contact.channel_id);
        igPsid = sub?.ig_id ?? null;
        if (igPsid) await supabase.from('contacts').update({ ig_psid: igPsid }).eq('id', contact_id);
      }
    }

    if (igPsid) {
      const r = await sendInstagram(igPsid, content, metaMedia);
      if (r.ok) { method = 'meta_instagram'; ok = true; }
      else {
        errDetail = r.error ?? '';
        // Fallback: ManyChat (solo para texto, ManyChat sendContent no soporta attachment.url bien)
        if (contact.channel_id && !metaMedia) {
          const r2 = await sendManyChat(contact.channel_id, content, 'ig');
          if (r2.ok) { method = 'manychat'; ok = true; }
          else errDetail += ` | mc: ${r2.error}`;
        }
      }
    } else if (contact.channel_id && !metaMedia) {
      // No PSID resolved: try ManyChat directly (solo texto)
      const r = await sendManyChat(contact.channel_id, content, 'ig');
      if (r.ok) { method = 'manychat'; ok = true; }
      else { errDetail = `no_psid | mc: ${r.error}`; method = 'failed'; }
    } else if (metaMedia) {
      errDetail = 'no_psid_for_media';
      method = 'failed';
    }

  // ── Facebook ────────────────────────────────────────────────────────────────
  } else if (contact.channel === 'facebook' && contact.channel_id) {
    const r = await sendFacebook(contact.channel_id, content, metaMedia);
    if (r.ok) { method = 'meta_messenger'; ok = true; }
    else {
      errDetail = r.error ?? '';
      if (!metaMedia) {
        const r2 = await sendManyChat(contact.channel_id, content, 'fb');
        if (r2.ok) { method = 'manychat'; ok = true; }
        else errDetail += ` | mc: ${r2.error}`;
      }
    }
  }

  if (!ok) method = 'failed';
  console.log(`send-message channel=${contact.channel} method=${method} ok=${ok} err=${errDetail.slice(0, 200)}`);

  // Auto-clasificación de etapa del pipeline (fire-and-forget) — el mensaje del vendedor
  // también puede mover etapa: "te recibo el sábado" → visita_programada, etc.
  supabase.functions.invoke('classify-message-stage', {
    body: { contact_id, message_id: msg.id },
  }).catch(console.error);

  return new Response(JSON.stringify({
    ok: true,
    message: msg,
    delivery: { ok, method, outside_window: outsideWindow || undefined, error: errDetail || undefined },
  }), { status: 200, headers: cors });
  } catch (e) {
    console.error('Unhandled error:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
