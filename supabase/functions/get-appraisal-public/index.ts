// Endpoint público (sin auth) que retorna una tasación por share_token.
// Trackea view automáticamente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    return new Response(JSON.stringify({ error: 'token required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { data: appraisal, error } = await sb
    .from('appraisals')
    .select('*')
    .eq('share_token', token)
    .maybeSingle();

  if (error || !appraisal) {
    return new Response(JSON.stringify({ error: 'Tasación no encontrada' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Fetch del agente
  let agent = null;
  if (appraisal.agent_id) {
    const { data: a } = await sb
      .from('agents')
      .select('name, phone, email, avatar_url, branch')
      .eq('id', appraisal.agent_id)
      .maybeSingle();
    agent = a;
  }

  // Tracking de view
  await sb.from('appraisals').update({
    view_count: (appraisal.view_count ?? 0) + 1,
    last_viewed_at: new Date().toISOString(),
  }).eq('id', appraisal.id);

  return new Response(JSON.stringify({ appraisal, agent }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
