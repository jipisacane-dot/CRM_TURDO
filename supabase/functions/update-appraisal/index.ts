// Actualiza una tasación existente. El vendedor (o Leticia) puede corregir
// el precio low/high y agregar notas. El precio original de la IA queda
// preservado en ai_suggested_low/high_usd para análisis histórico.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAuth } from '../_shared/auth.ts';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// CORS lockdown: solo dominios permitidos pueden invocar esta edge function.
const ALLOWED_ORIGINS = [
  'https://crm-turdo.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];
const isPreviewVercel = (o: string) =>
  /^https:\/\/crm-turdo-[a-z0-9]+-jipisacane-5891s-projects\.vercel\.app$/.test(o);

function buildCors(req: Request): Record<string, string> | null {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || isPreviewVercel(origin);
  if (!allowed) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (!CORS) return new Response('Forbidden origin', { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  // Auth check: bloquear invocaciones anonimas (Claude API caro / abuso)
  const authError = await requireAuth(req, CORS);
  if (authError) return authError;

  let body: {
    appraisal_id: string;
    suggested_price_low_usd?: number;
    suggested_price_high_usd?: number;
    notes?: string;
    status?: string;
  };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  if (!body.appraisal_id) {
    return new Response(JSON.stringify({ error: 'appraisal_id required' }), { status: 400, headers: CORS });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.suggested_price_low_usd === 'number') updates.suggested_price_low_usd = body.suggested_price_low_usd;
  if (typeof body.suggested_price_high_usd === 'number') updates.suggested_price_high_usd = body.suggested_price_high_usd;
  if (typeof body.notes === 'string') updates.notes = body.notes;
  if (typeof body.status === 'string') updates.status = body.status;

  if (Object.keys(updates).length === 0) {
    return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: CORS });
  }

  // Validación básica
  if (
    typeof updates.suggested_price_low_usd === 'number' &&
    typeof updates.suggested_price_high_usd === 'number' &&
    (updates.suggested_price_low_usd as number) >= (updates.suggested_price_high_usd as number)
  ) {
    return new Response(JSON.stringify({ error: 'low must be < high' }), { status: 400, headers: CORS });
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await sb
    .from('appraisals')
    .update(updates)
    .eq('id', body.appraisal_id)
    .select('id, share_token, suggested_price_low_usd, suggested_price_high_usd')
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(data), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
