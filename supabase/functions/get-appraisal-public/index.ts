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

  // Select explícito: excluye campos internos (calculation_breakdown, client_email, client_phone, agent_id)
  const { data: appraisal, error } = await sb
    .from('appraisals')
    .select(`
      id, share_token, created_at, updated_at,
      property_address, barrio, rooms, bedrooms, surface_m2, surface_total_m2,
      age_years, property_state, has_view, view_type, amenities,
      expenses_ars, floor_number, exposure, is_furnished, notes,
      client_name,
      suggested_price_low_usd, suggested_price_high_usd,
      comparables, ai_reasoning, market_summary, recommendations,
      estimated_sale_days, photos, view_count, last_viewed_at,
      pdf_url, status, sent_at,
      agent_id
    `)
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
