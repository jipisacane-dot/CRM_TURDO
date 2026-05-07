import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ManyChat channel → CRM channel
const channelMap: Record<string, string> = {
  fb: 'facebook',
  ig: 'instagram',
  wa: 'whatsapp',
  sms: 'whatsapp',
};

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Verificar secret opcional
  const secret = Deno.env.get('MANYCHAT_WEBHOOK_SECRET');
  if (secret) {
    const authHeader = req.headers.get('x-webhook-secret');
    if (authHeader !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // DEBUG: log full payload to diagnose subscriber ID issues
  console.log('manychat-webhook body:', JSON.stringify(body).slice(0, 800));

  // ManyChat payload
  const channelRaw = (body.channel as string) ?? 'fb';
  const channel = channelMap[channelRaw] ?? 'facebook';
  const channelId = String(body.id ?? body.key ?? '');

  // Strip unresolved ManyChat template vars like {{first_name}}
  const clean = (v: unknown) =>
    typeof v === 'string' ? v.replace(/\{\{[^}]+\}\}/g, '').trim() : '';

  const firstName = clean(body.first_name);
  const lastName = clean(body.last_name);
  const name = [firstName, lastName].filter(Boolean).join(' ') || clean(body.name) || 'Sin nombre';
  // For WhatsApp subscribers, phone comes as whatsapp_phone
  const phone = clean(body.phone) || clean(body.whatsapp_phone) || null;
  const email = clean(body.email) || null;
  // ig_id from ManyChat = Instagram PSID (needed to reply via Instagram Graph API)
  const igPsid = body.ig_id ? String(body.ig_id) : null;
  const lastMessageRaw = clean(body.last_input_text) || null;
  // Discard if ManyChat sent an unresolved template variable
  const lastMessage = lastMessageRaw && /^\{\{.*\}\}$/.test(lastMessageRaw.trim()) ? null : lastMessageRaw;
  const avatarUrl = (body.profile_pic as string) ?? null;
  const FB_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN');
  const MANYCHAT_KEY = Deno.env.get('MANYCHAT_API_KEY');

  if (!channelId) {
    return new Response('Missing subscriber id', { status: 400 });
  }

  // If WA contact has no phone, fetch it from ManyChat subscriber info
  let resolvedPhone = phone;
  if (channel === 'whatsapp' && !resolvedPhone && MANYCHAT_KEY) {
    try {
      const subResp = await fetch(
        `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${channelId}`,
        { headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}` } }
      );
      if (subResp.ok) {
        const subJson = await subResp.json();
        const wp = subJson?.data?.whatsapp_phone;
        if (wp) resolvedPhone = String(wp);
      }
    } catch { /* ignore */ }
  }

  // ── Custom fields de calificación enviados por los FLOWs de ManyChat ────────
  const propType = clean(body.property_type) || null;
  const propPurpose = clean(body.property_purpose) || null;
  const propRooms = clean(body.property_rooms) || null;
  const propZone = clean(body.property_zone) || null;
  const propBudget = clean(body.property_budget) || null;
  const propTimeline = clean(body.property_timeline) || null;
  const leadSource = clean(body.lead_source) || null;
  const postIdOrigen = clean(body.post_id_origen) || null;

  // Notes derivadas de los custom fields
  const noteParts: string[] = [];
  if (propType) noteParts.push(`Tipo: ${propType}`);
  if (propPurpose) noteParts.push(`Objetivo: ${propPurpose}`);
  if (propRooms) noteParts.push(`Ambientes: ${propRooms}`);
  if (propZone) noteParts.push(`Zona: ${propZone}`);
  if (propBudget) noteParts.push(`Presupuesto: ${propBudget}`);
  if (propTimeline) noteParts.push(`Timing: ${propTimeline}`);
  if (leadSource) noteParts.push(`Fuente: ${leadSource}`);
  if (postIdOrigen) noteParts.push(`Post: ${postIdOrigen}`);
  const calificationNotes = noteParts.length > 0 ? noteParts.join(' · ') : null;

  // Upsert contacto por channel_id
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .upsert(
      {
        channel_id: channelId,
        channel,
        name,
        phone: resolvedPhone,
        email,
        avatar_url: avatarUrl,
        ...(igPsid ? { ig_psid: igPsid } : {}),
        status: 'new',
        branch: 'Sucursal Centro',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'channel_id,channel', ignoreDuplicates: false }
    )
    .select()
    .single();

  // Si vinieron datos calificados, mergear con notes existentes (no pisar)
  if (contact && calificationNotes) {
    const existingNotes = (contact.notes ?? '').trim();
    const hasCalif = existingNotes.length > 0 && /tipo:|objetivo:|zona:/i.test(existingNotes);
    if (!hasCalif) {
      const merged = [existingNotes, calificationNotes].filter(Boolean).join(' | ');
      await supabase.from('contacts').update({ notes: merged }).eq('id', contact.id);
    }
  }

  if (contactError) {
    console.error('Error upserting contact:', contactError);
    return new Response(JSON.stringify({ error: contactError.message }), { status: 500 });
  }

  // Intentar obtener foto de perfil si no vino en el payload — solo FB/IG, el endpoint /picture no aplica a WhatsApp
  if (!avatarUrl && contact && FB_TOKEN && channelId && (channel === 'facebook' || channel === 'instagram')) {
    try {
      const picResp = await fetch(
        `https://graph.facebook.com/v21.0/${channelId}/picture?redirect=false&type=square&access_token=${FB_TOKEN}`
      );
      if (picResp.ok) {
        const picData = await picResp.json();
        const url = picData?.data?.url;
        if (url) await supabase.from('contacts').update({ avatar_url: url }).eq('id', contact.id);
      }
    } catch { /* silently ignore */ }
  }

  // Insertar mensaje si viene texto — deduplicado por hash del contenido + canal + ventana de 5min
  if (lastMessage && contact) {
    // Minute bucket rounded to 5 so ManyChat retries within a few minutes collide and dedup
    const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
    // djb2 hash of content to keep the mid short and deterministic
    let hash = 5381;
    for (let i = 0; i < lastMessage.length; i++) hash = ((hash << 5) + hash + lastMessage.charCodeAt(i)) | 0;
    const metaMid = `mc_${channel}_${channelId}_${bucket}_${Math.abs(hash).toString(36)}`;

    await supabase.from('messages').upsert(
      {
        contact_id: contact.id,
        direction: 'in',
        content: lastMessage,
        channel,
        meta_mid: metaMid,
        read: false,
      },
      { onConflict: 'meta_mid', ignoreDuplicates: true }
    );

    // Auto-detectar email y teléfono en el mensaje
    const updates: Record<string, string> = {};
    if (!contact.phone) {
      const phoneMatch = lastMessage.match(/(?:\+54|0)?(?:11|[2-9]\d)[\s-]?\d{4}[\s-]?\d{4}|\b\d{10,11}\b/);
      if (phoneMatch) updates.phone = phoneMatch[0].replace(/[\s-]/g, '');
    }
    if (!contact.email) {
      const emailMatch = lastMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) updates.email = emailMatch[0];
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('contacts').update(updates).eq('id', contact.id);
    }
  }

  // Send push notification — targeted to assigned agent if any
  if (lastMessage && contact) {
    const contactName = contact.name ?? 'Nuevo mensaje';
    supabase.functions.invoke('send-push', {
      body: {
        title: contactName,
        body: lastMessage.slice(0, 100),
        contact_id: contact.id,
        url: '/inbox',
        agent_id: contact.assigned_to ?? undefined,
      },
    }).catch(console.error);

    // Auto-clasificación de etapa del pipeline (fire-and-forget)
    supabase.functions.invoke('classify-message-stage', {
      body: { contact_id: contact.id },
    }).catch(console.error);
  }

  return new Response(JSON.stringify({ ok: true, contact_id: contact?.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
