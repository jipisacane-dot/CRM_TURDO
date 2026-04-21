import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FB_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN')!;
const FB_PAGE_ID = Deno.env.get('FB_PAGE_ID')!;
const MANYCHAT_KEY = Deno.env.get('MANYCHAT_API_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let body: { contact_id: string; content: string; agent_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: corsHeaders });
  }

  const { contact_id, content, agent_id } = body;
  if (!contact_id || !content) {
    return new Response(JSON.stringify({ error: 'Missing contact_id or content' }), { status: 400, headers: corsHeaders });
  }

  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contact_id)
    .single();

  if (contactError || !contact) {
    return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404, headers: corsHeaders });
  }

  // Save message to DB first (always)
  const { data: msg, error: msgError } = await supabase
    .from('messages')
    .insert({
      contact_id,
      direction: 'out',
      content,
      channel: contact.channel,
      meta_mid: null,
      agent_id: agent_id ?? null,
      read: true,
    })
    .select()
    .single();

  if (msgError) {
    return new Response(JSON.stringify({ error: msgError.message }), { status: 500, headers: corsHeaders });
  }

  // Send via appropriate channel
  if (['instagram', 'facebook', 'whatsapp'].includes(contact.channel) && contact.channel_id) {

    // Send via ManyChat API for all channels
    const mcResp = await fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriber_id: Number(contact.channel_id),
        data: { version: 'v2', content: { messages: [{ type: 'text', text: content }] } },
      }),
    });
    if (!mcResp.ok) {
      const mcErr = await mcResp.json();
      console.error('ManyChat send error:', JSON.stringify(mcErr));
    }
  }

  // Send via ManyChat API (WhatsApp)
  if (contact.channel === 'whatsapp' && contact.channel_id) {
    const mcBody = {
      subscriber_id: Number(contact.channel_id),
      data: {
        version: 'v2',
        content: { messages: [{ type: 'text', text: content }] },
      },
    };
    const mcResp = await fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mcBody),
    });
    if (!mcResp.ok) {
      const err = await mcResp.json();
      console.error('ManyChat WhatsApp error:', JSON.stringify(err));
      // Retry with message_tag for out-of-session
      if (err.code === 3011) {
        const retryResp = await fetch('https://api.manychat.com/fb/sending/sendContent', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...mcBody, message_tag: 'ACCOUNT_UPDATE' }),
        });
        if (!retryResp.ok) console.error('ManyChat retry error:', JSON.stringify(await retryResp.json()));
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, message: msg }), { status: 200, headers: corsHeaders });
});
