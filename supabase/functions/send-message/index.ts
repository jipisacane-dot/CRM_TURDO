import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FB_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN')!;
const FB_PAGE_ID = Deno.env.get('FB_PAGE_ID')!;

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

  // Try to send via Meta Graph API
  if (contact.channel === 'instagram' || contact.channel === 'facebook') {
    const metaResp = await fetch(
      `https://graph.facebook.com/v21.0/${FB_PAGE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: contact.channel_id },
          message: { text: content },
          messaging_type: 'RESPONSE',
        }),
      }
    );

    if (!metaResp.ok) {
      const err = await metaResp.json();
      console.error('Meta API error:', JSON.stringify(err));
    }
  }

  return new Response(JSON.stringify({ ok: true, message: msg }), { status: 200, headers: corsHeaders });
});
