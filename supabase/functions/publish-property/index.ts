// Edge function: publish-property
// Valida que la propiedad esté lista para publicación pública,
// actualiza is_published + status, y deja stubs para sync con ML / web / ZP.
// Cuando ML/web estén activas a fin de mes, conectamos las llamadas reales acá.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAuth } from '../_shared/auth.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface PublishRequest {
  property_id: string;
  publish: boolean; // false = despublicar
}

// CORS lockdown
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {

  // Auth check: bloquear invocaciones anonimas (Claude API caro / abuso)
  const authError = await requireAuth(req, CORS);
  if (authError) return authError;
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  let body: PublishRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.property_id) return json({ error: 'property_id requerido' }, 400);

  // Buscamos la propiedad
  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('*')
    .eq('id', body.property_id)
    .maybeSingle();

  if (propErr || !prop) return json({ error: 'Propiedad no encontrada' }, 404);

  // ── Despublicar ──────────────────────────────────────
  if (body.publish === false) {
    await supabase.from('properties').update({ is_published: false }).eq('id', body.property_id);
    // TODO fin de mes: llamar a ML.delete + web.unpublish
    console.log('[publish-property] STUB unpublish ML:', prop.ml_item_id ?? '(no ml_item_id)');
    return json({ ok: true, action: 'unpublished' });
  }

  // ── Validaciones para publicar ────────────────────────
  const errors: string[] = [];
  if (!prop.address) errors.push('Falta dirección');
  if (!prop.list_price_usd || prop.list_price_usd <= 0) errors.push('Falta precio o es inválido');
  if (!prop.rooms && !prop.bedrooms) errors.push('Falta cantidad de ambientes/dormitorios');
  if (!prop.surface_m2) errors.push('Falta superficie cubierta');
  if (!prop.description) errors.push('Falta descripción');

  // Validamos que tenga al menos 1 foto
  const { count: photoCount } = await supabase
    .from('property_photos')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', body.property_id);
  if (!photoCount || photoCount === 0) errors.push('Falta subir al menos 1 foto');

  if (errors.length) {
    return json({ ok: false, errors }, 400);
  }

  // ── Publicar en CRM (siempre primero) ────────────────
  const { error: upErr } = await supabase
    .from('properties')
    .update({
      is_published: true,
      status: prop.status === 'borrador' ? 'disponible' : prop.status,
    })
    .eq('id', body.property_id);
  if (upErr) return json({ error: upErr.message }, 500);

  // ── STUBS: ML + Web + ZP ─────────────────────────────
  // Estos placeholders se reemplazan con llamadas reales cuando los integradores estén:
  // - ML: requiere OAuth + POST a /items (cuenta activa fin de mes)
  // - Web: la web del desarrollador va a leer de v_published_properties directamente,
  //        o le mandamos un webhook con el slug.
  // - ZP: por ahora se sigue cargando manualmente desde Tokko hasta firmar partner.
  const syncResults: Record<string, string> = {};

  // ML stub
  if (Deno.env.get('ML_ACCESS_TOKEN')) {
    syncResults.mercadolibre = 'TODO: implementar POST /items';
  } else {
    syncResults.mercadolibre = 'pendiente: cuenta ML aún no activa';
  }

  // Web stub
  const webHookUrl = Deno.env.get('TURDO_WEB_WEBHOOK_URL');
  if (webHookUrl) {
    try {
      await fetch(webHookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'property.published', slug: prop.slug, property_id: prop.id }),
      });
      syncResults.web = 'webhook enviado';
    } catch {
      syncResults.web = 'error enviando webhook';
    }
  } else {
    syncResults.web = 'pendiente: webhook de la web aún no configurado';
  }

  // ZP stub
  syncResults.zonaprop = 'manual: cargar desde Tokko (hasta firmar partner)';

  return json({
    ok: true,
    action: 'published',
    property: {
      id: prop.id,
      internal_code: prop.internal_code,
      slug: prop.slug,
      public_url: `https://crm-turdo.vercel.app/p/${prop.slug}`,
    },
    sync: syncResults,
  });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
