// Edge fn: get-blue-rate
// Devuelve la cotización dólar blue actual. Cachea por 1 hora en blue_rate_cache.
// Fuente: dolarapi.com (free, no auth).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAuth } from '../_shared/auth.ts';
import { buildCors } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

async function fetchBlueRate(): Promise<{ compra: number; venta: number; source_date: string } | null> {
  try {
    const resp = await fetch('https://dolarapi.com/v1/dolares/blue', {
      headers: { 'User-Agent': 'turdo-crm/1.0' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (typeof data?.compra !== 'number' || typeof data?.venta !== 'number') return null;
    return {
      compra: data.compra,
      venta: data.venta,
      source_date: data.fechaActualizacion ?? new Date().toISOString(),
    };
  } catch (e) {
    console.warn('[get-blue-rate] fetch err:', e);
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (!cors) return new Response('Forbidden origin', { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const authError = await requireAuth(req, cors);
  if (authError) return authError;

  // Leer cache
  const { data: cache } = await sb
    .from('blue_rate_cache')
    .select('compra, venta, promedio, fetched_at, source_date')
    .eq('id', 1)
    .maybeSingle();

  const cacheAge = cache?.fetched_at
    ? Date.now() - new Date(cache.fetched_at).getTime()
    : Infinity;

  // Si cache fresca, devolver
  if (cache && cacheAge < CACHE_TTL_MS) {
    return new Response(JSON.stringify({
      ...cache,
      cached: true,
    }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // Refrescar de la API
  const fresh = await fetchBlueRate();
  if (!fresh) {
    // Si la API falla pero tenemos cache vieja, devolver la vieja con warning
    if (cache) {
      return new Response(JSON.stringify({
        ...cache,
        cached: true,
        stale: true,
        warning: 'No se pudo refrescar, devolviendo cache anterior',
      }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'No se pudo obtener cotización' }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // Upsert cache
  await sb.from('blue_rate_cache').upsert({
    id: 1,
    compra: fresh.compra,
    venta: fresh.venta,
    fetched_at: new Date().toISOString(),
    source_date: fresh.source_date,
  });

  return new Response(JSON.stringify({
    compra: fresh.compra,
    venta: fresh.venta,
    promedio: (fresh.compra + fresh.venta) / 2,
    fetched_at: new Date().toISOString(),
    source_date: fresh.source_date,
    cached: false,
  }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
});
