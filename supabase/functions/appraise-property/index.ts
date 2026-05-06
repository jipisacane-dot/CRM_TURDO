// Tasación de propiedad con IA: busca comparables en Tokko + Claude Sonnet razona el precio.
// Retorna {suggested_price_low_usd, suggested_price_high_usd, comparables, ai_reasoning,
// market_summary, recommendations, estimated_sale_days}.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const TOKKO_KEY = Deno.env.get('TOKKO_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `Sos un tasador inmobiliario experto en Mar del Plata, Argentina, trabajando para Turdo Estudio Inmobiliario.

Tu trabajo: dado los datos de una propiedad y propiedades comparables del mercado actual, tasarla con criterio profesional.

REGLAS:
- Tasación realista, no infladá ni baja. La idea es publicar al precio óptimo para vender en 30-60 días.
- Compará SIEMPRE contra los comparables. No inventes precios.
- Si los comparables son pocos o no son representativos, indicalo en el reasoning.
- Considerá: zona, m² cubiertos, ambientes, antigüedad, estado (a estrenar / reciclado / usado), vista al mar, balcón, cochera, amenities.
- En MdP el premium por vista al mar es +15-25%. Premium reciclado +10-15% sobre usado mismo metraje.
- El RANGO sugerido debe ser realista — diferencia entre low y high de 5-10% típicamente.
- Estimá días de venta basado en historial: bien tasado = 30-60d, sobrevaluado = 90-180d.
- Recomendaciones CONCRETAS y accionables (ej: "subir 5 fotos profesionales del balcón con vista al mar", NO "mejorar la presentación").

OUTPUT estricto en JSON, sin markdown:
{
  "suggested_price_low_usd": 105000,
  "suggested_price_high_usd": 115000,
  "ai_reasoning": "El depto se ubica un 8% sobre comparables similares de la zona porque tiene vista al mar (premium +15%) y está reciclado a estrenar. El comparable más cercano es Boulevard Marítimo 1900 a USD 109K con 48 m² sin vista directa. Tu propiedad de 35 m² con vista compite mejor en la franja USD 105-115K.",
  "market_summary": "El mercado en Plaza Mitre / Centro está activo. Las unidades recicladas con vista al mar se posicionan en USD 100-120K. Salen en 30-60 días si están bien fotografiadas.",
  "recommendations": [
    "Subir 8-12 fotos profesionales con luz natural mañana",
    "Destacar la vista al mar en el primer plano del aviso",
    "Publicar en Zonaprop, Argenprop y MeLi simultáneamente para maximizar alcance",
    "Considerar aceptar ofertas a partir de USD 100K"
  ],
  "estimated_sale_days": 45
}`;

interface PropertyInput {
  address: string;
  barrio?: string;
  rooms?: number;
  bedrooms?: number;
  surface_m2?: number;
  surface_total_m2?: number;
  age_years?: number;
  property_state?: string;
  has_view?: boolean;
  view_type?: string;
  amenities?: string[];
  expenses_ars?: number;
  floor_number?: number;
  exposure?: string;
  notes?: string;
}

interface Comparable {
  source: string;
  reference_code?: string;
  address: string;
  barrio?: string;
  price_usd: number;
  m2: number;
  rooms?: number;
  state?: string;
  age?: number;
  link?: string;
  notes?: string;
}

// Busca propiedades comparables en Tokko (mismo barrio, ±25% m², ±30% precio si conocido)
async function findTokkoComparables(input: PropertyInput): Promise<Comparable[]> {
  if (!TOKKO_KEY) return [];
  try {
    const url = `https://www.tokkobroker.com/api/v1/property/?key=${TOKKO_KEY}&format=json&limit=400`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    const props = (j.objects ?? []) as Array<Record<string, unknown>>;

    const targetM2 = input.surface_m2 ?? input.surface_total_m2 ?? 0;
    const targetBarrio = (input.barrio ?? '').toLowerCase();
    const targetRooms = input.rooms ?? 0;

    const scored = props.map(p => {
      const ops = (p.operations as Array<Record<string, unknown>>) ?? [];
      const sale = ops.find(o => o.operation_type === 'Venta');
      if (!sale) return null;
      const prices = (sale.prices as Array<Record<string, unknown>>) ?? [];
      const usd = prices.find(pr => pr.currency === 'USD');
      if (!usd) return null;
      const price = Number(usd.price ?? 0);
      if (price < 30000 || price > 1000000) return null; // descartar fuera de rango razonable

      const m2 = Number(p.surface ?? p.total_surface ?? 0);
      if (m2 < 15 || m2 > 500) return null;

      const location = (p.location as Record<string, unknown>) ?? {};
      const barrio = String(location.name ?? '').toLowerCase();
      const address = String(p.address ?? '');
      const rooms = Number(p.room_amount ?? 0);

      // Score de similaridad
      let score = 0;
      if (targetBarrio && barrio.includes(targetBarrio.split(' ')[0])) score += 50;
      if (targetBarrio && address.toLowerCase().includes(targetBarrio)) score += 20;
      if (targetM2 > 0) {
        const m2Diff = Math.abs(m2 - targetM2) / targetM2;
        if (m2Diff < 0.15) score += 30;
        else if (m2Diff < 0.30) score += 15;
      }
      if (targetRooms > 0 && rooms === targetRooms) score += 20;
      else if (targetRooms > 0 && Math.abs(rooms - targetRooms) === 1) score += 8;

      const condition = String(p.property_condition ?? '');
      const ageAge = Number(p.age ?? 0);

      return {
        score,
        comp: {
          source: 'Tokko',
          reference_code: String(p.reference_code ?? ''),
          address: address || (location.full_location as string) || 'Sin dirección',
          barrio: String(location.name ?? ''),
          price_usd: price,
          m2,
          rooms,
          state: condition,
          age: ageAge,
          link: `https://www.tokkobroker.com/property/${p.id}`,
        } as Comparable,
      };
    }).filter((x): x is { score: number; comp: Comparable } => x !== null && x.score >= 30);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(s => s.comp);
  } catch (e) {
    console.error('Tokko search err', e);
    return [];
  }
}

async function callClaude(propertyData: PropertyInput, comparables: Comparable[]): Promise<Record<string, unknown> | null> {
  const propText = `
PROPIEDAD A TASAR:
- Dirección: ${propertyData.address}
- Barrio: ${propertyData.barrio ?? '?'}
- Ambientes: ${propertyData.rooms ?? '?'} (dormitorios: ${propertyData.bedrooms ?? '?'})
- Superficie cubierta: ${propertyData.surface_m2 ?? '?'} m²
- Superficie total: ${propertyData.surface_total_m2 ?? '?'} m²
- Antigüedad: ${propertyData.age_years ?? '?'} años
- Estado: ${propertyData.property_state ?? '?'}
- Piso: ${propertyData.floor_number ?? '?'} (${propertyData.exposure ?? '?'})
- Vista: ${propertyData.has_view ? `Sí (${propertyData.view_type ?? 'no especificado'})` : 'Sin vista destacada'}
- Amenities: ${(propertyData.amenities ?? []).join(', ') || 'Ninguno destacado'}
- Expensas: ${propertyData.expenses_ars ? `ARS ${propertyData.expenses_ars}` : '?'}
- Notas: ${propertyData.notes ?? '(sin notas)'}
`;

  const compsText = comparables.length > 0
    ? `COMPARABLES DEL MERCADO (Tokko):
${comparables.map((c, i) => `${i+1}. ${c.address} (${c.barrio}) — USD ${c.price_usd.toLocaleString()} | ${c.m2} m² | ${c.rooms ?? '?'} amb | estado: ${c.state ?? '?'} | antigüedad: ${c.age ?? '?'} años`).join('\n')}`
    : 'COMPARABLES: no se encontraron suficientes en Tokko, evaluá con conocimiento general del mercado MdP.';

  const userPrompt = `${propText}\n${compsText}\n\nGenerá la tasación en el formato JSON pedido.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    console.error('Claude err', resp.status, await resp.text());
    return null;
  }

  const data = await resp.json();
  const text: string = data?.content?.[0]?.text ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: { property?: PropertyInput; agent_id?: string; agent_email?: string; contact_id?: string; client?: { name?: string; email?: string; phone?: string }; save?: boolean };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { property, agent_id, agent_email, contact_id, client, save = true } = body;
  if (!property?.address) {
    return new Response(JSON.stringify({ error: 'property.address required' }), { status: 400, headers: CORS });
  }

  // 1. Comparables Tokko
  const comparables = await findTokkoComparables(property);

  // 2. IA tasa
  const result = await callClaude(property, comparables);
  if (!result) {
    return new Response(JSON.stringify({ error: 'AI service error' }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const lowUsd = Number(result.suggested_price_low_usd ?? 0);
  const highUsd = Number(result.suggested_price_high_usd ?? 0);

  // 3. Resolver agent UUID si vino mock
  const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
  let resolvedAgentId = agent_id ?? '';
  if (!isUuid(resolvedAgentId)) {
    const lookup = agent_email ?? (resolvedAgentId.includes('@') ? resolvedAgentId : null);
    if (lookup) {
      const { data: a } = await sb.from('agents').select('id').eq('email', lookup).maybeSingle();
      if (a) resolvedAgentId = a.id;
    }
  }

  // 4. Guardar appraisal en DB
  let appraisalId: string | null = null;
  if (save && isUuid(resolvedAgentId)) {
    const { data: row, error } = await sb.from('appraisals').insert({
      contact_id: contact_id ?? null,
      agent_id: resolvedAgentId,
      property_address: property.address,
      barrio: property.barrio ?? null,
      rooms: property.rooms ?? null,
      bedrooms: property.bedrooms ?? null,
      surface_m2: property.surface_m2 ?? null,
      surface_total_m2: property.surface_total_m2 ?? null,
      age_years: property.age_years ?? null,
      property_state: property.property_state ?? null,
      has_view: property.has_view ?? false,
      view_type: property.view_type ?? null,
      amenities: property.amenities ?? [],
      expenses_ars: property.expenses_ars ?? null,
      floor_number: property.floor_number ?? null,
      exposure: property.exposure ?? null,
      notes: property.notes ?? null,
      client_name: client?.name ?? null,
      client_email: client?.email ?? null,
      client_phone: client?.phone ?? null,
      suggested_price_low_usd: lowUsd,
      suggested_price_high_usd: highUsd,
      comparables: comparables,
      ai_reasoning: String(result.ai_reasoning ?? ''),
      market_summary: String(result.market_summary ?? ''),
      recommendations: result.recommendations ?? [],
      estimated_sale_days: Number(result.estimated_sale_days ?? 0),
    }).select('id').single();
    if (!error) appraisalId = row?.id ?? null;
  }

  return new Response(JSON.stringify({
    appraisal_id: appraisalId,
    suggested_price_low_usd: lowUsd,
    suggested_price_high_usd: highUsd,
    comparables,
    ai_reasoning: result.ai_reasoning,
    market_summary: result.market_summary,
    recommendations: result.recommendations,
    estimated_sale_days: result.estimated_sale_days,
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
