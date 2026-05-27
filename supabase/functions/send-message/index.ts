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

// Envía un template MENSAJE iniciado por business (fuera de ventana 24h).
// Solo funciona con templates pre-aprobados por Meta (status=APPROVED en Business Manager).
// Los parameters van en orden: el primero reemplaza {{1}}, el segundo {{2}}, etc.
async function sendWhatsAppTemplate(
  phone: string,
  templateName: string,
  language: string,
  parameters: string[]
): Promise<{ ok: boolean; error?: string; wamid?: string }> {
  if (!WA_PHONE_NUMBER_ID) return { ok: false, error: 'WHATSAPP_PHONE_NUMBER_ID not set' };
  const to = phone.replace(/\D/g, '');

  const components: Array<Record<string, unknown>> = [];
  if (parameters.length > 0) {
    components.push({
      type: 'body',
      parameters: parameters.map(p => ({ type: 'text', text: p })),
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  const resp = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await resp.json();
  if (!resp.ok) {
    return { ok: false, error: JSON.stringify(result) };
  }
  const wamid = result?.messages?.[0]?.id;
  return { ok: true, wamid };
}

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

// Reply público debajo del comment. Aprovecha el alcance orgánico del post.
async function replyToFacebookComment(commentId: string, text: string) {
  const resp = await fetch(`https://graph.facebook.com/v20.0/${commentId}/comments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${FB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  });
  const result = await resp.json();
  if (!resp.ok) return { ok: false, error: JSON.stringify(result) };
  return { ok: true, id: result.id as string };
}

// Private reply: abre/usa la conversación de Messenger con el commentista
// AUNQUE nunca haya mensajeado a la página antes. Solo se permite UN private
// reply por cada comment, después la conversación sigue por DM normal.
// NOTA: el endpoint /private_replies se reemplazó por /me/messages con
// recipient.comment_id (formato actual de Meta).
async function privateReplyToComment(commentId: string, text: string) {
  const resp = await fetch('https://graph.facebook.com/v20.0/me/messages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${FB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text },
    }),
  });
  const result = await resp.json();
  if (!resp.ok) return { ok: false, error: JSON.stringify(result) };
  return { ok: true };
}

// Flow namespaces — uno por tipo de contenido. El de texto es el original.
const MANYCHAT_WA_FLOW_NS       = Deno.env.get('MANYCHAT_WA_FLOW_NS')       ?? ''; // texto solo (existing)
const MANYCHAT_WA_FLOW_NS_IMAGE = Deno.env.get('MANYCHAT_WA_FLOW_NS_IMAGE') ?? '';
const MANYCHAT_WA_FLOW_NS_AUDIO = Deno.env.get('MANYCHAT_WA_FLOW_NS_AUDIO') ?? '';
const MANYCHAT_WA_FLOW_NS_VIDEO = Deno.env.get('MANYCHAT_WA_FLOW_NS_VIDEO') ?? '';
const MANYCHAT_WA_FLOW_NS_FILE  = Deno.env.get('MANYCHAT_WA_FLOW_NS_FILE')  ?? '';

const MANYCHAT_WA_FIELD_ID = 14515582; // crm_reply (text)
const MANYCHAT_WA_MEDIA_URL_FIELD_ID     = Number(Deno.env.get('MANYCHAT_WA_MEDIA_URL_FIELD_ID')     ?? '0');
const MANYCHAT_WA_MEDIA_CAPTION_FIELD_ID = Number(Deno.env.get('MANYCHAT_WA_MEDIA_CAPTION_FIELD_ID') ?? '0');

interface ManyChatWAMediaArgs { url: string; type: 'image' | 'video' | 'audio' | 'document'; caption?: string }

function flowNsForMedia(type: ManyChatWAMediaArgs['type']): string {
  switch (type) {
    case 'image':    return MANYCHAT_WA_FLOW_NS_IMAGE;
    case 'audio':    return MANYCHAT_WA_FLOW_NS_AUDIO;
    case 'video':    return MANYCHAT_WA_FLOW_NS_VIDEO;
    case 'document': return MANYCHAT_WA_FLOW_NS_FILE;
  }
}

// ── ManyChat sendContent — soporta media nativa (image/audio/video/file) ─────
// Solo funciona si el subscriber existe en ManyChat (inbound vino via ManyChat).
async function sendManyChatContentWA(
  subscriberId: string,
  text: string,
  media?: ManyChatWAMediaArgs
): Promise<{ ok: boolean; error?: string; outsideWindow?: boolean }> {
  const messages: Array<Record<string, unknown>> = [];

  if (media) {
    // Map CRM media type → ManyChat message type
    const mcType = media.type === 'document' ? 'file' : media.type; // image|audio|video|file
    const block: Record<string, unknown> = { type: mcType, url: media.url };
    if (media.caption && (media.type === 'image' || media.type === 'video')) {
      block.caption = media.caption;
    }
    messages.push(block);
    // Si hay caption + texto adicional, mandar también como text
    if (text && text !== media.caption && text !== `[${media.type}]`) {
      messages.push({ type: 'text', text });
    }
  } else {
    messages.push({ type: 'text', text });
  }

  // NOTA: ManyChat NO acepta message_tag (ej. HUMAN_AGENT) para WhatsApp.
  // Solo lo acepta para Messenger. Para WhatsApp fuera de ventana 24h, la
  // única salida es usar templates aprobados por Meta — eso requiere setup
  // separado en el WhatsApp Business Manager.
  const body: Record<string, unknown> = {
    subscriber_id: Number(subscriberId),
    data: { version: 'v2', content: { messages } },
  };

  const resp = await fetch('https://api.manychat.com/fb/sending/sendContent', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await resp.text();
  let result: Record<string, unknown>;
  try { result = JSON.parse(raw); } catch { result = { status: 'error', message: raw.slice(0, 200) }; }
  // Log COMPLETO sin truncar — ManyChat suele poner el detail real
  // en result.details.messages[]
  console.log(`ManyChat sendContent WA status=${resp.status} type=${media?.type ?? 'text'} url=${media?.url?.slice(0, 80) ?? '-'} fullBody=${JSON.stringify(result)}`);

  if (resp.ok && result?.status === 'success') return { ok: true };

  // Detectar errores de ventana 24h
  const fullJson = JSON.stringify(result).toLowerCase();
  const isWindowError = fullJson.includes('24 hour') || fullJson.includes('outside') || fullJson.includes('message tag') || fullJson.includes('last interaction was over');

  // Componer mensaje de error que SÍ incluya los details
  const details = (result as { details?: { messages?: unknown[] } }).details;
  const detailStr = details?.messages ? JSON.stringify(details.messages).slice(0, 300) : '';
  const errMsg = `${result?.message ?? 'unknown'}${detailStr ? ` | details: ${detailStr}` : ''}`;

  return { ok: false, error: `sendContent: ${errMsg}`, outsideWindow: isWindowError };
}

async function setMCField(subscriberId: number, fieldId: number, value: string): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch('https://api.manychat.com/fb/subscriber/setCustomField', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_id: subscriberId, field_id: fieldId, field_value: value }),
  });
  const raw = await resp.text();
  let result: Record<string, unknown>;
  try { result = JSON.parse(raw); } catch { result = { status: 'error', message: raw.slice(0, 100) }; }
  console.log(`ManyChat setField id=${fieldId} status=${resp.status} value="${value.slice(0,40)}"`);
  if (!resp.ok || result?.status !== 'success') {
    return { ok: false, error: String(result?.message ?? JSON.stringify(result)) };
  }
  return { ok: true };
}

// ── ManyChat WhatsApp via flow ────────────────────────────────────────────────
// Si hay media → setea campos media + dispara flow específico del tipo.
// Si no hay media → setea solo crm_reply + dispara flow de texto.
async function sendManyChatWA(subscriberId: string, text: string, media?: ManyChatWAMediaArgs): Promise<{ ok: boolean; error?: string; outsideWindow?: boolean }> {
  const subId = Number(subscriberId);
  let flowNs: string;

  if (media) {
    flowNs = flowNsForMedia(media.type);
    if (!flowNs) return { ok: false, error: `MANYCHAT_WA_FLOW_NS_${media.type.toUpperCase()} not configured` };
    if (!MANYCHAT_WA_MEDIA_URL_FIELD_ID) return { ok: false, error: 'MANYCHAT_WA_MEDIA_URL_FIELD_ID not configured' };

    // Setear URL del media
    const r1 = await setMCField(subId, MANYCHAT_WA_MEDIA_URL_FIELD_ID, media.url);
    if (!r1.ok) return { ok: false, error: `setField media_url: ${r1.error}` };

    // Caption opcional (solo image/video)
    if (MANYCHAT_WA_MEDIA_CAPTION_FIELD_ID && (media.type === 'image' || media.type === 'video')) {
      await setMCField(subId, MANYCHAT_WA_MEDIA_CAPTION_FIELD_ID, media.caption ?? '');
    }
  } else {
    flowNs = MANYCHAT_WA_FLOW_NS;
    if (!flowNs) return { ok: false, error: 'MANYCHAT_WA_FLOW_NS not configured' };

    // Setear texto en crm_reply
    const r1 = await setMCField(subId, MANYCHAT_WA_FIELD_ID, text);
    if (!r1.ok) return { ok: false, error: `setField crm_reply: ${r1.error}` };
  }

  // Trigger flow
  const flowResp = await fetch('https://api.manychat.com/fb/sending/sendFlow', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_id: subId, flow_ns: flowNs }),
  });
  const rawFlow = await flowResp.text();
  let flowResult: Record<string, unknown>;
  try { flowResult = JSON.parse(rawFlow); } catch { flowResult = { status: 'error', message: rawFlow.slice(0, 100) }; }
  console.log(`ManyChat sendFlow ns=${flowNs} type=${media?.type ?? 'text'} status=${flowResp.status} body=${JSON.stringify(flowResult)}`);
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

// ── ManyChat subscriber: find existing or create new ─────────────────────────
// Cuando un vendedor manda mensaje y el contacto NO tiene manychat_subscriber_id,
// intentamos linkearlo en el momento. Si no lo encontramos por nombre, lo creamos
// vía Phone Import API. Sin esto los envíos a contactos viejos (los 462 sin
// linkear) fallarían siempre.
async function findOrCreateMCSubscriberForWA(phone: string, name: string): Promise<string | null> {
  if (!MANYCHAT_KEY || !phone) return null;
  const normalizedPhone = phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`;

  // 1. Buscar por nombre + match por phone (rápido si ya existe en ManyChat)
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
      console.warn('[send-message] findByName err:', e);
    }
  }

  // 2. Crear con Phone Import API
  const parts = (name || '').trim().split(/\s+/);
  const firstName = parts[0] && parts[0] !== 'Sin' ? parts[0] : 'Contacto';
  const lastName = parts.length > 1 && parts[0] !== 'Sin' ? parts.slice(1).join(' ') : '-';
  try {
    const r = await fetch('https://api.manychat.com/fb/subscriber/createSubscriber', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
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
        console.log(`[send-message] createSubscriber OK ${normalizedPhone} → ${id}`);
        return String(id);
      }
    }
    console.log(`[send-message] createSubscriber failed for ${normalizedPhone}: ${raw.slice(0, 200)}`);
  } catch (e) {
    console.warn('[send-message] createSubscriber err:', e);
  }
  return null;
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
    // Template fuera de ventana 24h (WSP only, requiere meta_template_status='APPROVED')
    template_id?: string;
  };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: cors }); }

  const { contact_id, content, agent_id, media_type, media_url, media_path, media_caption, media_mime, media_filename, media_size_bytes, template_id } = body;
  if (!contact_id || (!content && !media_url && !template_id))
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: cors });

  const isMedia = !!(media_type && media_url);

  const { data: contact, error: ce } = await supabase
    .from('contacts').select('*').eq('id', contact_id).single();
  if (ce || !contact)
    return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404, headers: cors });

  // ── TEMPLATE SEND (WSP fuera de ventana 24h) ────────────────────────────────
  // Si vino template_id, esto reemplaza el flujo normal. Carga el template, valida
  // que esté APPROVED en Meta, renderiza variables, y manda via Cloud API directo.
  if (template_id) {
    if (contact.channel !== 'whatsapp') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Templates solo funcionan en WhatsApp' }),
        { status: 400, headers: cors }
      );
    }
    if (!contact.phone) {
      return new Response(
        JSON.stringify({ ok: false, no_phone: true, error: 'El contacto no tiene teléfono cargado' }),
        { status: 400, headers: cors }
      );
    }

    const { data: tpl, error: tplErr } = await supabase
      .from('message_templates')
      .select('*')
      .eq('id', template_id)
      .single();
    if (tplErr || !tpl) {
      return new Response(JSON.stringify({ ok: false, error: 'Template no encontrado' }), { status: 404, headers: cors });
    }
    if (!tpl.is_24h_template || tpl.meta_template_status !== 'APPROVED' || !tpl.meta_template_name) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Template no usable: is_24h=${tpl.is_24h_template}, status=${tpl.meta_template_status}, name=${tpl.meta_template_name}`
        }),
        { status: 400, headers: cors }
      );
    }

    // Resolver variables del template body en el orden que aparecen
    // {nombre}, {propiedad}, etc. → ['Juan', 'Brown 2500'] → Meta {{1}}, {{2}}
    const firstName = (contact.name as string ?? '').split(' ')[0] || 'cliente';
    const varResolvers: Record<string, string> = {
      nombre: firstName,
      telefono: (contact.phone as string) ?? '',
      email: (contact.email as string) ?? '',
      propiedad: (contact.property_title as string) ?? 'la propiedad consultada',
      sucursal: (contact.branch as string) ?? 'Corrientes',
    };
    const orderedParams: string[] = [];
    const varRe = /\{(\w+)\}/g;
    let m: RegExpExecArray | null;
    const body = tpl.body as string;
    while ((m = varRe.exec(body)) !== null) {
      const varName = m[1];
      orderedParams.push(varResolvers[varName] ?? `{${varName}}`);
    }

    const r = await sendWhatsAppTemplate(
      contact.phone as string,
      tpl.meta_template_name as string,
      (tpl.meta_template_language as string) ?? 'es_AR',
      orderedParams
    );

    // Renderizar el body localmente para guardarlo legible en messages.content
    let renderedBody = body;
    for (const [k, v] of Object.entries(varResolvers)) {
      renderedBody = renderedBody.replaceAll(`{${k}}`, v);
    }

    const { data: tplMsg } = await supabase.from('messages').insert({
      contact_id,
      direction: 'out',
      content: renderedBody,
      channel: 'whatsapp',
      meta_mid: r.wamid ?? null,
      agent_id: agent_id ?? null,
      read: true,
      delivery_status: r.ok ? 'sent' : 'failed',
      delivery_error: r.ok ? null : (r.error ?? null),
    }).select().single();

    // Bump use_count del template
    await supabase.rpc('increment_template_use', { template_id }).catch(() => {});
    await supabase.from('message_templates')
      .update({ use_count: (tpl.use_count ?? 0) + 1 })
      .eq('id', template_id);

    return new Response(JSON.stringify({
      ok: r.ok,
      method: 'whatsapp_template',
      message: tplMsg,
      delivery: { ok: r.ok, error: r.error, outside_window: false },
    }), { status: 200, headers: cors });
  }

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

    // WhatsApp routing (estable post 25/05):
    // 1) Si NO hay manychat_subscriber_id Y hay phone → crear subscriber AHORA
    //    (vía findOrCreateMCSubscriberForWA). Esto destraba contactos viejos
    //    sin linkear y nuevos donde el webhook todavía no procesó.
    // 2) Con subscriber → sendContent (soporta texto + media nativa)
    // 3) Sin subscriber Y sin phone (caso extremo, ej contacto manual sin tel)
    //    → fallar claramente para que vendor edite el contacto
    let mcSubscriberId = (contact.manychat_subscriber_id as string | null) ?? null;

    if (!mcSubscriberId && phone && MANYCHAT_KEY) {
      const name = (contact.name as string) ?? '';
      const found = await findOrCreateMCSubscriberForWA(phone, name);
      if (found) {
        mcSubscriberId = found;
        await supabase.from('contacts').update({ manychat_subscriber_id: mcSubscriberId }).eq('id', contact_id);
        console.log(`[send-message] auto-linked contact ${contact_id} → MC ${mcSubscriberId}`);
      }
    }

    const mcMedia = waMedia ? { url: waMedia.url, type: waMedia.type, caption: waMedia.caption } : undefined;

    if (mcSubscriberId) {
      // Camino principal: sendContent (texto + media nativa por igual)
      const r = await sendManyChatContentWA(mcSubscriberId, content, mcMedia);
      if (r.ok) { method = 'manychat_content'; ok = true; }
      else {
        errDetail = `mc_content: ${r.error}`;
        outsideWindow = r.outsideWindow ?? false;
        // Fallback a sendFlow solo para texto (fuera-de-ventana edge case)
        if (!waMedia) {
          const r2 = await sendManyChatWA(mcSubscriberId, content, undefined);
          if (r2.ok) { method = 'manychat_flow'; ok = true; outsideWindow = false; }
          else { errDetail += ` | mc_flow: ${r2.error}`; }
        }
      }
    } else if (!phone) {
      // Contacto sin phone Y sin subscriber → no podemos enviar
      method = 'failed';
      errDetail = 'no_phone_no_subscriber';
      outsideWindow = false;
    } else {
      // Subscriber no se pudo crear (Phone Import quizás deshabilitado o ML rate limit)
      // Como último recurso, Cloud API directo (en SMB tier devuelve #200,
      // pero lo intentamos para que el vendedor sepa el error real).
      if (WA_PHONE_NUMBER_ID) {
        const r = await sendWhatsApp(phone, content, waMedia);
        if (r.ok) { method = 'whatsapp_cloud'; ok = true; }
        else { outsideWindow = r.outsideWindow ?? false; errDetail = `wa_cloud_fallback: ${r.error ?? ''}`; }
      } else {
        method = 'failed';
        errDetail = 'no_send_path_available';
      }
    }

  // ── Instagram ───────────────────────────────────────────────────────────────
  } else if (contact.channel === 'instagram') {
    // PRIORIDAD: si tenemos manychat_subscriber_id, mandar por ManyChat directo.
    // La app TurdoManejoDeADS.com NO tiene capability `instagram_manage_messages`
    // aprobado por Meta, así que sendInstagram directo via Graph API falla con
    // "(#3) Application does not have the capability". El único path que funciona
    // hoy es ManyChat (que sí está aprobado por Meta para messaging IG).
    const mcSubIdIg = (contact.manychat_subscriber_id as string | null) ?? null;

    if (mcSubIdIg && !metaMedia) {
      // Camino principal: ManyChat sendContent
      const r = await sendManyChat(mcSubIdIg, content, 'ig');
      if (r.ok) { method = 'manychat'; ok = true; }
      else {
        errDetail = `mc: ${r.error}`;
        outsideWindow = r.outsideWindow ?? false;
      }
    } else {
      // Sin subscriber_id: intentar Graph API (probablemente falla) o lookup
      let igPsid = (contact.ig_psid as string | null) ?? null;

      if (!igPsid && contact.channel_id) {
        if (contact.channel_id.length > 12 && /^\d+$/.test(contact.channel_id)) {
          igPsid = contact.channel_id;
          await supabase.from('contacts').update({ ig_psid: igPsid }).eq('id', contact_id);
        } else {
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
          if (contact.channel_id && !metaMedia) {
            const r2 = await sendManyChat(contact.channel_id, content, 'ig');
            if (r2.ok) { method = 'manychat'; ok = true; }
            else errDetail += ` | mc: ${r2.error}`;
          }
        }
      } else if (contact.channel_id && !metaMedia) {
        const r = await sendManyChat(contact.channel_id, content, 'ig');
        if (r.ok) { method = 'manychat'; ok = true; }
        else { errDetail = `no_psid | mc: ${r.error}`; method = 'failed'; }
      } else if (metaMedia) {
        errDetail = 'no_psid_for_media';
        method = 'failed';
      }
    }

  // ── Facebook ────────────────────────────────────────────────────────────────
  } else if (contact.channel === 'facebook' && contact.channel_id) {
    // Si el ÚLTIMO mensaje del cliente fue un comentario en post, hacemos
    // doble disparo: reply público debajo del comment + private_reply (que
    // abre el DM con el commentista, AUNQUE nunca haya mensajeado a la página).
    // Esto se aplica cada vez que el lead deja un nuevo comment, no solo en
    // la primera respuesta — porque cada comment es una pieza independiente
    // de feedback público que requiere su propia respuesta visible.
    const { data: lastIn } = await supabase
      .from('messages')
      .select('media_type, meta_mid')
      .eq('contact_id', contact_id)
      .eq('direction', 'in')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastInIsComment = lastIn?.media_type === 'comment' && lastIn?.meta_mid;

    // Si el contacto vino de un Lead Form (channel_id sintético tipo meta_lead_XXX)
    // y tiene manychat_subscriber_id, ManyChat es el camino real de entrega.
    // ManyChat ya capturó al lead via el Form integration y lo puede contactar
    // por WhatsApp directamente. NO intentar Facebook Messenger porque el
    // synthetic channel_id no es un PSID real y va a fallar.
    const isMetaLeadSynthetic = String(contact.channel_id).startsWith('meta_lead_');
    const mcSubIdFb = (contact.manychat_subscriber_id as string | null) ?? null;
    if (isMetaLeadSynthetic && mcSubIdFb && !metaMedia) {
      const r = await sendManyChatContentWA(mcSubIdFb, content);
      if (r.ok) { method = 'manychat_content'; ok = true; }
      else {
        errDetail = `mc_content: ${r.error}`;
        outsideWindow = r.outsideWindow ?? false;
        // Fallback sendFlow
        const r2 = await sendManyChatWA(mcSubIdFb, content, undefined);
        if (r2.ok) { method = 'manychat_flow'; ok = true; outsideWindow = false; }
        else errDetail += ` | mc_flow: ${r2.error}`;
      }
    } else if (lastInIsComment && !metaMedia) {
      const commentId = lastIn!.meta_mid as string;
      const firstName = (contact.name?.split(' ')[0] ?? '').trim();
      // El reply público lleva un teaser corto que dirige a DM (no exponemos
      // info de venta en el post — si el cliente pregunta precio público,
      // respondemos lo justo y derivamos al privado).
      const publicTeaser = firstName
        ? `¡Hola ${firstName}! Te paso info por privado 📩`
        : '¡Hola! Te pasamos info por privado 📩';

      const pubR = await replyToFacebookComment(commentId, publicTeaser);
      // El DM contiene el mensaje real del vendedor.
      const dmR = await privateReplyToComment(commentId, content);

      if (dmR.ok) { method = 'fb_private_reply'; ok = true; }
      else errDetail = `private_reply: ${dmR.error}`;
      if (!pubR.ok) errDetail += ` | public_reply: ${pubR.error}`;
    } else {
      // Sin comment pendiente: DM normal vía Messenger
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
  }

  if (!ok) method = 'failed';
  console.log(`send-message channel=${contact.channel} method=${method} ok=${ok} err=${errDetail.slice(0, 200)}`);

  // Persistir delivery_status en el mensaje para que el UI pueda mostrar
  // claramente "no entregado" en vez de aparentar éxito.
  if (msg.id) {
    await supabase.from('messages').update({
      delivery_status: ok ? 'sent' : 'failed',
      delivery_error: ok ? null : errDetail.slice(0, 500),
    }).eq('id', msg.id);
  }

  // Auto-clasificación de etapa del pipeline (fire-and-forget) — solo si OK,
  // sino estaríamos clasificando intenciones de mensajes que nunca llegaron.
  if (ok) {
    supabase.functions.invoke('classify-message-stage', {
      body: { contact_id, message_id: msg.id },
    }).catch(console.error);
  }

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
