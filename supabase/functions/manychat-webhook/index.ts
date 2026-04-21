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
  const name = [body.first_name, body.last_name].filter(Boolean).join(' ') || (body.name as string) || 'Sin nombre';
  const phone = (body.phone as string) ?? null;
  const email = (body.email as string) ?? null;
  const lastMessage = (body.last_input_text as string) ?? null;

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
  }

  return new Response(JSON.stringify({ ok: true, contact_id: contact?.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
