// Genera un portal del cliente: token único + registro en client_portals.
// Llamado desde el chat del CRM cuando el vendedor toca "Generar link cliente".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const PUBLIC_BASE_URL = Deno.env.get('PUBLIC_PORTAL_BASE_URL') ?? 'https://crm-turdo.vercel.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function generateToken(length = 10): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // sin l/o/0/1 para legibilidad
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: { contact_id?: string; agent_id?: string; agent_email?: string; property_ids?: string[]; greeting?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { contact_id, agent_id: rawAgentId, agent_email, property_ids = [], greeting } = body;
  if (!contact_id || (!rawAgentId && !agent_email)) {
    return new Response(JSON.stringify({ error: 'contact_id and agent_id or agent_email required' }), { status: 400, headers: CORS });
  }

  // Resolver el agent_id real (UUID) — el front capaz manda mock id ('leticia') o email.
  // Buscamos por id (si parece UUID) o por email.
  const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
  let agent_id = rawAgentId ?? '';
  if (!isUuid(agent_id)) {
    const lookupEmail = agent_email ?? (rawAgentId?.includes('@') ? rawAgentId : null);
    if (lookupEmail) {
      const { data: a } = await supabase.from('agents').select('id').eq('email', lookupEmail).maybeSingle();
      if (a) agent_id = a.id;
    } else if (rawAgentId) {
      // Intentar match por name LIKE (mock id 'leticia' → "Leticia Turdo")
      const { data: a } = await supabase.from('agents').select('id').ilike('name', `${rawAgentId}%`).maybeSingle();
      if (a) agent_id = a.id;
    }
  }

  if (!isUuid(agent_id)) {
    return new Response(JSON.stringify({ error: 'Could not resolve agent UUID' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Generar token único (con retry por colisión, muy improbable)
  let token = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    token = generateToken(10);
    const { data: existing } = await supabase
      .from('client_portals')
      .select('id')
      .eq('token', token)
      .maybeSingle();
    if (!existing) break;
    token = '';
  }
  if (!token) {
    return new Response(JSON.stringify({ error: 'Could not generate unique token' }), { status: 500, headers: CORS });
  }

  const { data: portal, error } = await supabase
    .from('client_portals')
    .insert({
      token,
      contact_id,
      agent_id,
      property_ids,
      client_greeting: greeting ?? null,
    })
    .select()
    .single();

  if (error || !portal) {
    return new Response(JSON.stringify({ error: error?.message ?? 'Insert failed' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const url = `${PUBLIC_BASE_URL}/c/${token}`;

  return new Response(JSON.stringify({
    portal_id: portal.id,
    token,
    url,
    expires_at: portal.expires_at,
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
