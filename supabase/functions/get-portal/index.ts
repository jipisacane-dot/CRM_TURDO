// Endpoint PÚBLICO (sin auth) que retorna toda la info necesaria para renderizar
// la página del portal de un cliente, dado un token. Trackea automáticamente el view.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  let token = url.searchParams.get('token');
  if (!token && req.method === 'POST') {
    try { token = (await req.json()).token; } catch { /* ignore */ }
  }

  if (!token) {
    return new Response(JSON.stringify({ error: 'token required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { data: portal, error: pErr } = await supabase
    .from('client_portals')
    .select('id, token, contact_id, agent_id, property_ids, client_greeting, created_at, expires_at, is_active, view_count')
    .eq('token', token)
    .maybeSingle();

  if (pErr || !portal) {
    return new Response(JSON.stringify({ error: 'Portal not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (!portal.is_active) {
    return new Response(JSON.stringify({ error: 'Portal inactive' }), { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (new Date(portal.expires_at).getTime() < Date.now()) {
    return new Response(JSON.stringify({ error: 'Portal expired' }), { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Fetch contact, agent y propiedades en paralelo
  const [{ data: contact }, { data: agent }, { data: properties }] = await Promise.all([
    supabase.from('contacts').select('id, name, channel, phone, email').eq('id', portal.contact_id).maybeSingle(),
    supabase.from('agents').select('id, name, email, phone, avatar_url, branch').eq('id', portal.agent_id).maybeSingle(),
    portal.property_ids.length > 0
      ? supabase.from('properties').select('id, tokko_sku, address, barrio, list_price_usd, rooms, surface_m2, status, description, cover_photo_url, notes').in('id', portal.property_ids)
      : Promise.resolve({ data: [] }),
  ]);

  // Trackear view + actualizar last_viewed_at + view_count
  const ua = req.headers.get('user-agent') ?? null;
  await Promise.all([
    supabase.from('portal_events').insert({
      portal_id: portal.id,
      event_type: 'view',
      event_data: {},
      user_agent: ua,
    }),
    supabase.from('client_portals').update({
      view_count: (portal.view_count ?? 0) + 1,
      last_viewed_at: new Date().toISOString(),
    }).eq('id', portal.id),
  ]);

  return new Response(JSON.stringify({
    portal: {
      id: portal.id,
      token: portal.token,
      greeting: portal.client_greeting,
      created_at: portal.created_at,
    },
    contact: contact ? { name: contact.name, channel: contact.channel } : null,
    agent: agent ? {
      name: agent.name,
      phone: agent.phone,
      avatar_url: agent.avatar_url,
      branch: agent.branch,
      email: agent.email,
    } : null,
    properties: properties ?? [],
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
