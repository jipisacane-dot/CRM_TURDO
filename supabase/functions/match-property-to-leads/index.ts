// Cuando entra una propiedad nueva (o se llama manualmente), busca todos los leads con preferencias
// que matcheen y guarda los matches en property_lead_matches con su score.
// Usa la función SQL fn_upsert_match para evaluar cada par (property, contact).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: { property_id?: string; contact_id?: string; min_score?: number };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const minScore = body.min_score ?? 60;

  // Modo 1: una propiedad → matchear contra todos los leads
  if (body.property_id) {
    const { data: leads } = await sb.from('lead_preferences').select('contact_id');
    if (!leads) return new Response(JSON.stringify({ matches: 0 }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

    let count = 0;
    const sample: Array<{ contact_id: string; score: number }> = [];
    for (const lead of leads) {
      const { data: scoreData } = await sb.rpc('fn_upsert_match', {
        p_property_id: body.property_id,
        p_contact_id: lead.contact_id,
      });
      const score = scoreData ?? 0;
      if (score >= minScore) {
        count++;
        if (sample.length < 10) sample.push({ contact_id: lead.contact_id, score });
      }
    }
    return new Response(JSON.stringify({ matches: count, sample }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Modo 2: un contact → matchear contra todas las propiedades disponibles
  if (body.contact_id) {
    const { data: props } = await sb.from('properties')
      .select('id, status')
      .or('status.eq.disponible,status.eq.available,status.is.null');
    if (!props) return new Response(JSON.stringify({ matches: 0 }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

    let count = 0;
    const sample: Array<{ property_id: string; score: number }> = [];
    for (const prop of props) {
      const { data: scoreData } = await sb.rpc('fn_upsert_match', {
        p_property_id: prop.id,
        p_contact_id: body.contact_id,
      });
      const score = scoreData ?? 0;
      if (score >= minScore) {
        count++;
        if (sample.length < 10) sample.push({ property_id: prop.id, score });
      }
    }
    return new Response(JSON.stringify({ matches: count, sample }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'property_id or contact_id required' }), {
    status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
