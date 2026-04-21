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
  const igId = body.ig_id ? String(body.ig_id) : null;
  const email = clean(body.email) || null;
  const lastMessage = (body.last_input_text as string) ?? null;
  const avatarUrl = (body.profile_pic as string) ?? null;
  const FB_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN');

  if (!channelId) {
    return new Response('Missing subscriber id', { status: 400 });
  }

  // Upsert contacto por channel_id
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .upsert(
      {
        channel_id: channelId,
        channel,
        name,
        phone,
        email,
        avatar_url: avatarUrl,
        ig_psid: igId,
        status: 'new',
        branch: 'Sucursal Centro',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'channel_id,channel', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (contactError) {
    console.error('Error upserting contact:', contactError);
    return new Response(JSON.stringify({ error: contactError.message }), { status: 500 });
  }

  // Intentar obtener foto de perfil si no vino en el payload
  if (!avatarUrl && contact && FB_TOKEN && channelId) {
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

  // Insertar mensaje si viene texto
  if (lastMessage && contact) {
    const metaMid = `mc_${channelId}_${Date.now()}`;
    await supabase.from('messages').insert({
      contact_id: contact.id,
      direction: 'in',
      content: lastMessage,
      channel,
      meta_mid: metaMid,
      read: false,
    });

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

  return new Response(JSON.stringify({ ok: true, contact_id: contact?.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
