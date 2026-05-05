// Endpoint PÚBLICO (sin auth) para trackear eventos del portal del cliente.
// Eventos: photo_open, plan_download, ficha_download, visit_request, question_sent, scroll_bottom, etc.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_EVENT_TYPES = new Set([
  'view', 'photo_open', 'plan_download', 'ficha_download',
  'visit_request', 'question_sent', 'whatsapp_click',
  'map_click', 'scroll_bottom', 'leave',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: { token?: string; event_type?: string; event_data?: Record<string, unknown> };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  const { token, event_type, event_data = {} } = body;
  if (!token || !event_type) {
    return new Response(JSON.stringify({ error: 'token and event_type required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (!VALID_EVENT_TYPES.has(event_type)) {
    return new Response(JSON.stringify({ error: `unknown event_type ${event_type}` }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Resolve portal by token
  const { data: portal } = await supabase
    .from('client_portals')
    .select('id, contact_id, agent_id, is_active')
    .eq('token', token)
    .maybeSingle();

  if (!portal || !portal.is_active) {
    return new Response(JSON.stringify({ error: 'Portal not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  await supabase.from('portal_events').insert({
    portal_id: portal.id,
    event_type,
    event_data,
    user_agent: req.headers.get('user-agent') ?? null,
  });

  // Si es visit_request o question_sent, trigger un push al vendedor + crear mensaje IN para que entre al chat
  if (event_type === 'visit_request') {
    const slot = (event_data as Record<string, unknown>).slot ?? '';
    const text = `📅 ${event_data.client_name ?? 'El cliente'} pidió visita: ${slot}`;
    await supabase.functions.invoke('send-push', {
      body: { title: '📅 Visita solicitada desde el portal', body: text, contact_id: portal.contact_id, url: '/inbox', agent_id: portal.agent_id },
    }).catch(() => {});
    // Insertar mensaje IN sintético para que el vendedor lo vea en el chat
    await supabase.from('messages').insert({
      contact_id: portal.contact_id,
      direction: 'in',
      content: `[via portal] Pidió visita: ${slot}`,
      channel: 'web',
      meta_mid: `portal_visit_${portal.id}_${Date.now()}`,
      read: false,
    });
  } else if (event_type === 'question_sent') {
    const question = (event_data as Record<string, unknown>).question ?? '';
    await supabase.functions.invoke('send-push', {
      body: { title: '💬 Pregunta desde el portal', body: String(question).slice(0, 100), contact_id: portal.contact_id, url: '/inbox', agent_id: portal.agent_id },
    }).catch(() => {});
    await supabase.from('messages').insert({
      contact_id: portal.contact_id,
      direction: 'in',
      content: `[via portal] ${question}`,
      channel: 'web',
      meta_mid: `portal_q_${portal.id}_${Date.now()}`,
      read: false,
    });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
