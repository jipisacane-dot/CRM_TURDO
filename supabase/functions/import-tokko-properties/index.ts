// Import propiedades desde Tokko Broker → tabla properties del CRM.
// Trae todas las propiedades activas, las mapea al schema interno, y upsertea
// por tokko_sku. También inserta fotos en property_photos.
//
// Invocación:
//   POST /functions/v1/import-tokko-properties
//   Authorization: Bearer <SERVICE_ROLE_KEY>
//   Body: { only_active?: boolean = true, limit?: number, dry_run?: boolean = false }
//
// Tokko status: 1=draft/unpublished, 2=active, 3=reserved, 4=sold/rented
// CRM status:   borrador, disponible, reservada, vendida, alquilada, caida, pausada

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// No usamos requireAuth: edge runtime ya valida JWT en plataforma (verify_jwt=true).
// Esta función es admin-only y solo se invoca con service_role JWT desde scripts.

const TOKKO_KEY = Deno.env.get('TOKKO_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TokkoPhoto { image: string; thumb: string; is_front_cover: boolean; order: number }
interface TokkoOpPrice { price: number; currency: string }
interface TokkoOperation { operation_type: string; prices: TokkoOpPrice[] }
interface TokkoLocation { id: number; name: string; full_location: string }
interface TokkoProperty {
  id: number;
  reference_code?: string;
  publication_title?: string;
  address?: string;
  fake_address?: string;
  description?: string;
  type?: { id: number; name: string };
  status: number;
  room_amount?: number;
  suite_amount?: number;
  bathroom_amount?: number;
  parking_lot_amount?: number;
  surface?: string;
  roofed_surface?: string;
  total_surface?: string;
  age?: number;
  expenses?: number;
  orientation?: string;
  location?: TokkoLocation;
  operations: TokkoOperation[];
  photos: TokkoPhoto[];
  branch?: { id: number; name: string };
  videos?: Array<{ player_url?: string; provider?: string; video_id?: string }>;
  created_at?: string;
  updated_at?: string;
  geo_lat?: number | string;
  geo_long?: number | string;
  public_url?: string;
}

interface TokkoMeta { total_count: number; limit: number; offset: number }
interface TokkoListResponse { meta: TokkoMeta; objects: TokkoProperty[] }

// Map Tokko status → CRM status
const STATUS_MAP: Record<number, string> = {
  1: 'borrador',
  2: 'disponible',
  3: 'reservada',
  4: 'vendida',
};

// Map Tokko type.name → CRM property_type (lowercase, sin acentos)
function mapPropertyType(tokkoName?: string): string {
  if (!tokkoName) return 'departamento';
  const t = tokkoName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (t.includes('departamento')) return 'departamento';
  if (t.includes('casa')) return 'casa';
  if (t.includes('ph')) return 'ph';
  if (t.includes('local')) return 'local';
  if (t.includes('cochera')) return 'cochera';
  if (t.includes('terreno') || t.includes('lote')) return 'terreno';
  if (t.includes('quinta')) return 'quinta';
  if (t.includes('oficina')) return 'oficina';
  if (t.includes('galpon') || t.includes('depósito') || t.includes('deposito')) return 'galpon';
  return 'departamento';
}

function mapOperationType(tokkoOp?: string): string {
  if (!tokkoOp) return 'venta';
  const t = tokkoOp.toLowerCase();
  if (t.includes('alquiler temporario') || t.includes('temporario')) return 'temporario';
  if (t.includes('alquiler')) return 'alquiler';
  return 'venta';
}

function parseSurface(s?: string): number | null {
  if (!s) return null;
  const m = String(s).match(/[\d.,]+/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function buildAddress(p: TokkoProperty): string {
  return (p.fake_address || p.address || p.publication_title || 'Sin dirección').trim();
}

async function fetchAllTokko(onlyActive: boolean, limit?: number): Promise<TokkoProperty[]> {
  const PAGE = 200;
  const all: TokkoProperty[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const qs = new URLSearchParams({
      key: TOKKO_KEY,
      format: 'json',
      lang: 'es_ar',
      limit: String(PAGE),
      offset: String(offset),
    });
    const url = `https://www.tokkobroker.com/api/v1/property/?${qs}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Tokko API ${r.status}: ${await r.text()}`);
    const j = await r.json() as TokkoListResponse;
    total = j.meta?.total_count ?? 0;
    all.push(...(j.objects ?? []));
    offset += PAGE;
    if (limit && all.length >= limit) break;
    if (!j.objects?.length) break;
  }

  const filtered = onlyActive ? all.filter(p => p.status === 2 || p.status === 3) : all;
  return limit ? filtered.slice(0, limit) : filtered;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!TOKKO_KEY) {
    return new Response(JSON.stringify({ error: 'TOKKO_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  let opts: { only_active?: boolean; limit?: number; dry_run?: boolean } = {};
  try { opts = await req.json(); } catch { /* body opcional */ }

  const onlyActive = opts.only_active ?? true;
  const dryRun = opts.dry_run ?? false;
  const limit = opts.limit;

  console.log(`[import-tokko] start. only_active=${onlyActive} limit=${limit ?? 'all'} dry_run=${dryRun}`);

  let tokkoProps: TokkoProperty[];
  try {
    tokkoProps = await fetchAllTokko(onlyActive, limit);
  } catch (e) {
    console.error('[import-tokko] fetch err:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`[import-tokko] fetched ${tokkoProps.length} props from Tokko`);

  if (dryRun) {
    return new Response(JSON.stringify({
      dry_run: true,
      total_from_tokko: tokkoProps.length,
      sample: tokkoProps.slice(0, 3).map(p => ({
        id: p.id,
        ref: p.reference_code,
        address: buildAddress(p),
        status: p.status,
        type: p.type?.name,
        op: p.operations[0]?.operation_type,
        price: p.operations[0]?.prices[0],
        photos: p.photos?.length ?? 0,
      })),
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  let inserted = 0, updated = 0, skipped = 0, errors = 0;
  const errLog: Array<{ tokko_id: number; err: string }> = [];

  for (const p of tokkoProps) {
    const sku = String(p.id);
    const mainOp = p.operations?.[0];
    const mainPrice = mainOp?.prices?.[0];

    if (!mainPrice || mainPrice.price <= 0) {
      skipped++;
      continue;
    }

    const lat = p.geo_lat ? Number(p.geo_lat) : null;
    const lng = p.geo_long ? Number(p.geo_long) : null;

    const record: Record<string, unknown> = {
      tokko_sku: sku,
      address: buildAddress(p),
      description: p.description ?? '',
      property_type: mapPropertyType(p.type?.name),
      operation_type: mapOperationType(mainOp?.operation_type),
      status: STATUS_MAP[p.status] ?? 'borrador',
      list_price_usd: mainPrice.currency === 'USD' ? mainPrice.price : null,
      price_currency: mainPrice.currency === 'ARS' ? 'ARS' : 'USD',
      rooms: p.room_amount ?? null,
      bedrooms: p.suite_amount ?? null,
      bathrooms: p.bathroom_amount ?? null,
      garage: p.parking_lot_amount ?? 0,
      surface_m2: parseSurface(p.roofed_surface),
      surface_total_m2: parseSurface(p.total_surface ?? p.surface),
      age_years: p.age ?? null,
      orientation: p.orientation ?? null,
      latitude: lat && !isNaN(lat) ? lat : null,
      longitude: lng && !isNaN(lng) ? lng : null,
      expenses_ars: p.expenses ?? null,
      is_published: p.status === 2,
      cover_photo_url: p.photos?.find(ph => ph.is_front_cover)?.image ?? p.photos?.[0]?.image ?? null,
      video_url: p.videos?.[0]?.player_url ?? null,
    };

    // Lookup existing
    const { data: existing, error: lookupErr } = await sb
      .from('properties')
      .select('id')
      .eq('tokko_sku', sku)
      .maybeSingle();

    if (lookupErr) {
      errors++; errLog.push({ tokko_id: p.id, err: `lookup: ${lookupErr.message}` });
      continue;
    }

    if (existing?.id) {
      const { error: updErr } = await sb.from('properties').update(record).eq('id', existing.id);
      if (updErr) { errors++; errLog.push({ tokko_id: p.id, err: `update: ${updErr.message}` }); continue; }
      updated++;
      // Refrescar fotos: borrar las viejas y reinsertar
      await sb.from('property_photos').delete().eq('property_id', existing.id);
      if (p.photos?.length) {
        const photoRows = p.photos.map((ph, i) => ({
          property_id: existing.id,
          url: ph.image,
          order_index: ph.order ?? i,
          is_cover: ph.is_front_cover,
        }));
        await sb.from('property_photos').insert(photoRows);
      }
    } else {
      const { data: inserted_row, error: insErr } = await sb
        .from('properties').insert(record).select('id').single();
      if (insErr) { errors++; errLog.push({ tokko_id: p.id, err: `insert: ${insErr.message}` }); continue; }
      inserted++;
      if (inserted_row?.id && p.photos?.length) {
        const photoRows = p.photos.map((ph, i) => ({
          property_id: inserted_row.id,
          url: ph.image,
          order_index: ph.order ?? i,
          is_cover: ph.is_front_cover,
        }));
        await sb.from('property_photos').insert(photoRows);
      }
    }
  }

  console.log(`[import-tokko] done. inserted=${inserted} updated=${updated} skipped=${skipped} errors=${errors}`);

  return new Response(JSON.stringify({
    ok: true,
    total_from_tokko: tokkoProps.length,
    inserted,
    updated,
    skipped,
    errors,
    error_sample: errLog.slice(0, 10),
  }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
