// Persiste una tasación ya generada. NO llama a IA — solo guarda en DB.
// Se usa cuando el agente confirma (eventualmente con precios editados) el resultado de appraise-property.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: {
    property?: Record<string, unknown>;
    client?: { name?: string; email?: string; phone?: string };
    photos?: Array<{ url: string; caption?: string }>;
    agent_id?: string;
    agent_email?: string;
    contact_id?: string;
    suggested_price_low_usd: number;
    suggested_price_high_usd: number;
    ai_suggested_low_usd?: number;
    ai_suggested_high_usd?: number;
    comparables?: unknown[];
    ai_reasoning?: string;
    calculation_breakdown?: string;
    market_summary?: string;
    recommendations?: string[];
    estimated_sale_days?: number;
  };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { property, client, photos = [], agent_id, agent_email, contact_id } = body;
  if (!property?.address) {
    return new Response(JSON.stringify({ error: 'property.address required' }), { status: 400, headers: CORS });
  }

  // Resolver agent UUID si vino mock
  const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
  let resolvedAgentId = agent_id ?? '';
  if (!isUuid(resolvedAgentId)) {
    const lookup = agent_email ?? (resolvedAgentId.includes('@') ? resolvedAgentId : null);
    if (lookup) {
      const { data: a } = await sb.from('agents').select('id').eq('email', lookup).maybeSingle();
      if (a) resolvedAgentId = a.id;
    }
  }
  if (!isUuid(resolvedAgentId)) {
    return new Response(JSON.stringify({ error: 'agent_id no resolvable' }), { status: 400, headers: CORS });
  }

  // Generar share_token único
  const generateToken = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let t = '';
    for (let i = 0; i < 10; i++) t += chars[Math.floor(Math.random() * chars.length)];
    return t;
  };
  let shareToken = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    shareToken = generateToken();
    const { data: existing } = await sb.from('appraisals').select('id').eq('share_token', shareToken).maybeSingle();
    if (!existing) break;
    shareToken = '';
  }

  const { data: row, error } = await sb.from('appraisals').insert({
    contact_id: contact_id ?? null,
    agent_id: resolvedAgentId,
    share_token: shareToken,
    photos,
    property_address: String(property.address),
    barrio: (property.barrio as string) ?? null,
    rooms: (property.rooms as number) ?? null,
    bedrooms: (property.bedrooms as number) ?? null,
    surface_m2: (property.surface_m2 as number) ?? null,
    surface_total_m2: (property.surface_total_m2 as number) ?? null,
    age_years: (property.age_years as number) ?? null,
    property_state: (property.property_state as string) ?? null,
    has_view: (property.has_view as boolean) ?? false,
    view_type: (property.view_type as string) ?? null,
    amenities: (property.amenities as string[]) ?? [],
    expenses_ars: (property.expenses_ars as number) ?? null,
    floor_number: (property.floor_number as number) ?? null,
    exposure: (property.exposure as string) ?? null,
    is_furnished: (property.is_furnished as boolean) ?? false,
    notes: (property.notes as string) ?? null,
    client_name: client?.name ?? null,
    client_email: client?.email ?? null,
    client_phone: client?.phone ?? null,
    suggested_price_low_usd: body.suggested_price_low_usd,
    suggested_price_high_usd: body.suggested_price_high_usd,
    ai_suggested_low_usd: body.ai_suggested_low_usd ?? body.suggested_price_low_usd,
    ai_suggested_high_usd: body.ai_suggested_high_usd ?? body.suggested_price_high_usd,
    comparables: body.comparables ?? [],
    ai_reasoning: body.ai_reasoning ?? '',
    calculation_breakdown: body.calculation_breakdown ?? '',
    market_summary: body.market_summary ?? '',
    recommendations: body.recommendations ?? [],
    estimated_sale_days: body.estimated_sale_days ?? 0,
  }).select('id, share_token').single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ appraisal_id: row?.id, share_token: row?.share_token }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
