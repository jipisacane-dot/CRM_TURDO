// Edge function: publish-property
// Valida que la propiedad esté lista para publicación pública,
// actualiza is_published + status, y deja stubs para sync con ML / web / ZP.
// Cuando ML/web estén activas a fin de mes, conectamos las llamadas reales acá.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAuth } from '../_shared/auth.ts';
import { publishToML, updateMLItem, unpublishMLItem, type PropertyForML } from '../_shared/mercadolibre.ts';

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
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Auth check: bloquear invocaciones anónimas. ANTES estaba mal ubicado
  // dentro del if !== POST, así que en la práctica nunca se ejecutaba.
  const authError = await requireAuth(req, CORS);
  if (authError) return authError;

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

    const unpublishResults: Record<string, string> = {};

    // ML: pausar el item (no borrar — para mantener historial / poder reactivar)
    if (prop.ml_item_id) {
      const r = await unpublishMLItem(prop.ml_item_id, 'paused');
      unpublishResults.mercadolibre = r.ok ? 'pausado' : `error: ${r.error}`;
    } else {
      unpublishResults.mercadolibre = 'sin ml_item_id (no se publicó nunca)';
    }

    // Web: notificar webhook de despublicación
    const webHookUrl = Deno.env.get('TURDO_WEB_WEBHOOK_URL');
    if (webHookUrl && prop.slug) {
      try {
        await fetch(webHookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'property.unpublished', slug: prop.slug, property_id: prop.id }),
        });
        unpublishResults.web = 'webhook enviado';
      } catch (e) {
        unpublishResults.web = `error: ${(e as Error).message}`;
      }
    } else {
      unpublishResults.web = 'sin webhook configurado';
    }

    return json({ ok: true, action: 'unpublished', sync: unpublishResults });
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

  // ── Sync con plataformas externas ─────────────────────
  const syncResults: Record<string, string> = {};

  // ── Mercado Libre ────────────────────────────────────
  // Activa solo si ML_CLIENT_ID/SECRET/REFRESH_TOKEN están en Supabase secrets.
  // Si ya tenía ml_item_id, actualiza. Si no, crea uno nuevo y guarda el ID.
  if (Deno.env.get('ML_CLIENT_ID') && Deno.env.get('ML_REFRESH_TOKEN')) {
    // Obtener URLs públicas de las fotos para mandarle a ML
    const { data: photos } = await supabase
      .from('property_photos')
      .select('url')
      .eq('property_id', body.property_id)
      .order('order_index');
    const pictures = (photos ?? []).map(p => p.url as string).filter(Boolean);

    const propForML: PropertyForML = {
      id: prop.id,
      internal_code: prop.internal_code,
      address: prop.address,
      street: prop.street,
      street_number: prop.street_number,
      barrio: prop.barrio,
      city: prop.city,
      province: prop.province,
      description: prop.description,
      rooms: prop.rooms,
      bedrooms: prop.bedrooms,
      bathrooms: prop.bathrooms,
      garage: prop.garage,
      surface_m2: prop.surface_m2,
      surface_total_m2: prop.surface_total_m2,
      list_price_usd: prop.list_price_usd,
      price_currency: prop.price_currency,
      operation_type: prop.operation_type,
      property_type: prop.property_type,
      condition: prop.condition,
      latitude: prop.latitude,
      longitude: prop.longitude,
      ml_item_id: prop.ml_item_id,
    };

    if (prop.ml_item_id) {
      // Update existente
      const r = await updateMLItem(prop.ml_item_id, propForML, pictures);
      syncResults.mercadolibre = r.ok ? `actualizado (${prop.ml_item_id})` : `error: ${r.error}`;
    } else {
      // Create nuevo
      const r = await publishToML(propForML, pictures);
      if (r.ok) {
        await supabase.from('properties').update({ ml_item_id: r.item_id }).eq('id', body.property_id);
        syncResults.mercadolibre = `publicado: ${r.permalink}`;
      } else {
        syncResults.mercadolibre = `error: ${r.error}`;
      }
    }
  } else {
    syncResults.mercadolibre = 'desactivado: faltan ML_CLIENT_ID/ML_CLIENT_SECRET/ML_REFRESH_TOKEN en Supabase secrets';
  }

  // ── Web propia (turdopropiedades.com) ───────────────
  const webHookUrl = Deno.env.get('TURDO_WEB_WEBHOOK_URL');
  if (webHookUrl) {
    try {
      const webResp = await fetch(webHookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Optional: secret compartido para que la web valide el origen
          ...(Deno.env.get('TURDO_WEB_WEBHOOK_SECRET') ? { 'X-Webhook-Secret': Deno.env.get('TURDO_WEB_WEBHOOK_SECRET')! } : {}),
        },
        body: JSON.stringify({
          event: 'property.published',
          property_id: prop.id,
          slug: prop.slug,
          internal_code: prop.internal_code,
          // Payload completo para que la web pueda renderizar sin hacer query extra
          property: {
            title: prop.address ?? prop.internal_code,
            price: prop.list_price_usd,
            currency: prop.price_currency,
            operation: prop.operation_type,
            type: prop.property_type,
            address: prop.address,
            barrio: prop.barrio,
            city: prop.city,
            province: prop.province,
            rooms: prop.rooms,
            bedrooms: prop.bedrooms,
            bathrooms: prop.bathrooms,
            surface_m2: prop.surface_m2,
            description: prop.description,
            cover_photo: prop.cover_photo_url,
            public_url: `https://crm-turdo.vercel.app/p/${prop.slug}`,
          },
        }),
      });
      syncResults.web = webResp.ok ? 'webhook enviado' : `error HTTP ${webResp.status}`;
    } catch (e) {
      syncResults.web = `error: ${(e as Error).message}`;
    }
  } else {
    syncResults.web = 'desactivado: falta TURDO_WEB_WEBHOOK_URL en Supabase secrets';
  }

  // ── ZP ───────────────────────────────────────────────
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
