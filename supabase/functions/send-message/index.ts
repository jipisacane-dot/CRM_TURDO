import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FB_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN')!;
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? Deno.env.get('FB_PAGE_ACCESS_TOKEN')!;
const IG_TOKEN = Deno.env.get('INSTAGRAM_TOKEN') ?? Deno.env.get('FB_PAGE_ACCESS_TOKEN')!;
const IG_BUSINESS_ID = Deno.env.get('IG_BUSINESS_ACCOUNT_ID') ?? 'me';
const MANYCHAT_KEY = Deno.env.get('MANYCHAT_API_KEY')!;
const WA_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// Get full subscriber info from ManyChat (includes ig_id, whatsapp_phone, etc.)
async function getMCSubscriber(subscriberId: string): Promise<Record<string, unknown> | null> {
  try {
    const resp = await fetch(
      `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${subscriberId}`,
      { headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}` } }
    );
    if (!resp.ok) return null;
    const json = await resp.json();
    return json?.data ?? null;
  } catch { return null; }
}

// Send via Instagram Business Messaging API
async function sendInstagramMessage(igPsid: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch(`https://graph.facebook.com/v20.0/${IG_BUSINESS_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${IG_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: igPsid },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  });
  const result = await resp.json();
  if (!resp.ok) return { ok: false, error: JSON.stringify(result) };
  return { ok: true };
}

// Send via Facebook Page Messaging API
async function sendFacebookMessage(psid: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch('https://graph.facebook.com/v20.0/me/messages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${FB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  });
  const result = await resp.json();
  if (!resp.ok) return { ok: false, error: JSON.stringify(result) };
  return { ok: true };
}

// Send via WhatsApp Business Cloud API
async function sendWhatsAppMessage(toPhone: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!WA_PHONE_NUMBER_ID) return { ok: false, error: 'WHATSAPP_PHONE_NUMBER_ID not configured' };
  const resp = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'text',
      text: { body: text },
    }),
  });
  const result = await resp.json();
  if (!resp.ok) return { ok: false, error: JSON.stringify(result) };
  return { ok: true };
}

// Send via ManyChat (fallback for all channels)
async function sendManyChat(subscriberId: number, text: string): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch('https://api.manychat.com/fb/sending/sendContent', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MANYCHAT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      data: { version: 'v2', content: { messages: [{ type: 'text', text }] } },
    }),
  });
  const result = await resp.json();
  if (!resp.ok) return { ok: false, error: JSON.stringify(result) };
  return { ok: true };
}

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

  let deliveryMethod = 'none';
  let deliveryOk = false;
  let deliveryError = '';

  if (contact.channel === 'instagram' && contact.channel_id) {
    // Use ig_psid stored on contact, fallback to ManyChat lookup
    let igId = (contact.ig_psid as string | null) ?? null;
    if (!igId) {
      const subscriber = await getMCSubscriber(contact.channel_id);
      igId = subscriber?.ig_id ? String(subscriber.ig_id) : null;
    }
    console.log(`Instagram — mc_id:${contact.channel_id} ig_id:${igId}`);

    if (igId) {
      // Try Meta Graph API with real PSID (requires instagram_manage_messages on token)
      const result = await sendInstagramMessage(igId, content);
      if (result.ok) {
        deliveryMethod = 'meta_instagram'; deliveryOk = true;
      } else {
        deliveryError = `meta:${result.error}`;
        console.error('Meta IG failed:', result.error);
        // Fallback to ManyChat
        const mc = await sendManyChat(Number(contact.channel_id), content);
        if (mc.ok) { deliveryMethod = 'manychat'; deliveryOk = true; }
        else { deliveryMethod = 'failed'; deliveryError += ` mc:${mc.error}`; }
      }
    } else {
      const mc = await sendManyChat(Number(contact.channel_id), content);
      deliveryMethod = mc.ok ? 'manychat' : 'failed';
      deliveryOk = mc.ok;
      deliveryError = mc.error ?? '';
    }

  } else if (contact.channel === 'whatsapp' && contact.channel_id) {
    // Use phone stored on contact (saved by webhook), fallback to ManyChat lookup
    let waPhone = contact.phone as string | null;
    if (!waPhone) {
      const subscriber = await getMCSubscriber(contact.channel_id);
      waPhone = subscriber?.whatsapp_phone as string | null;
    }
    console.log(`WhatsApp — mc_id:${contact.channel_id} phone:${waPhone}`);

    if (waPhone && WA_PHONE_NUMBER_ID) {
      // Try WhatsApp Business Cloud API
      const result = await sendWhatsAppMessage(waPhone, content);
      if (result.ok) {
        deliveryMethod = 'whatsapp_cloud'; deliveryOk = true;
      } else {
        deliveryError = `wa_cloud:${result.error}`;
        console.error('WA Cloud failed:', result.error);
        // Fallback to ManyChat
        const mc = await sendManyChat(Number(contact.channel_id), content);
        if (mc.ok) { deliveryMethod = 'manychat'; deliveryOk = true; }
        else { deliveryMethod = 'failed'; deliveryError += ` mc:${mc.error}`; }
      }
    } else {
      const mc = await sendManyChat(Number(contact.channel_id), content);
      deliveryMethod = mc.ok ? 'manychat' : 'failed';
      deliveryOk = mc.ok;
      deliveryError = mc.error ?? '';
    }

  } else if (contact.channel === 'facebook' && contact.channel_id) {
    // Facebook Messenger — use Meta Graph API directly (token has pages_messaging)
    const result = await sendFacebookMessage(contact.channel_id, content);
    if (result.ok) {
      deliveryMethod = 'meta_messenger'; deliveryOk = true;
    } else {
      deliveryError = `meta:${result.error}`;
      const mc = await sendManyChat(Number(contact.channel_id), content);
      deliveryMethod = mc.ok ? 'manychat' : 'failed';
      deliveryOk = mc.ok;
      if (!mc.ok) deliveryError += ` mc:${mc.error}`;
    }
  }

  console.log(`Delivery: channel=${contact.channel} method=${deliveryMethod} ok=${deliveryOk} error=${deliveryError}`);

  return new Response(JSON.stringify({
    ok: true,
    message: msg,
    delivery: { ok: deliveryOk, method: deliveryMethod, error: deliveryError || undefined },
  }), { status: 200, headers: corsHeaders });
});
