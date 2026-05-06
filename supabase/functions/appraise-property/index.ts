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

const SYSTEM_PROMPT = `Sos un tasador inmobiliario senior con 15 años en Mar del Plata, Argentina. Trabajás para Turdo Estudio Inmobiliario y conocés EN DETALLE el mercado actual de la ciudad. La fecha de hoy es mayo 2026.

═══════════════════════════════════════════════════════════
TABLA DE PRECIOS USD/m² POR ZONA Y ESTADO (Mar del Plata, mayo 2026)
═══════════════════════════════════════════════════════════
Estos son valores de PUBLICACIÓN actuales — para tasación inicial sumá 5-8% adicional sobre el cierre esperado.

ZONA / BARRIO                          | USADO buen estado | RECICLADO | A ESTRENAR
──────────────────────────────────────|───────────────────|───────────|────────────
Centro (Av. Luro / Independencia)      | 1.400-1.700       | 1.700-2.000 | 2.000-2.400
Plaza Mitre / Plaza Colón              | 1.800-2.300       | 2.300-2.700 | 2.700-3.200
La Perla / Los Troncos                 | 1.700-2.100       | 2.100-2.500 | 2.500-3.000
Plaza España                           | 1.600-1.900       | 1.900-2.300 | 2.300-2.700
Avenida Alem / Constitución            | 1.500-1.800       | 1.800-2.200 | 2.200-2.600
Macrocentro (Brown / Colón altura)     | 1.300-1.600       | 1.600-1.900 | 1.900-2.300
Stella Maris / Playa Grande            | 2.200-2.700       | 2.700-3.200 | 3.200-3.800
Punta Mogotes / Bosque Peralta Ramos   | 1.200-1.500       | 1.500-1.800 | 1.800-2.200
Constitución alejada / B. Don Bosco    | 900-1.200         | 1.200-1.500 | 1.500-1.800
Norte (Av. Constitución 5000+)         | 1.000-1.400       | 1.400-1.700 | 1.700-2.000

═══════════════════════════════════════════════════════════
AJUSTES DE PRECIO (sumar / restar al USD/m² base)
═══════════════════════════════════════════════════════════
+15-25%  Vista directa al mar
+8-12%   Vista lateral al mar
+8-12%   Cochera incluida (en zonas centrales)
+5-8%    Balcón generoso / terraza
+5-10%   Edificio con amenities (piscina, SUM, parrilla)
+5%      Piso alto (5° o más) sin contrafrente
+3-5%    Mascotas permitidas

-10-15%  Antigüedad 30+ años en estado original
-8-12%   Sin balcón
-5-10%   Contrafrente
-5-10%   Expensas altas (>5% del valor mensual)
-15-20%  Estado regular / requiere refacción

═══════════════════════════════════════════════════════════
REGLAS DE TASACIÓN — CRÍTICAS
═══════════════════════════════════════════════════════════
1. SIEMPRE empezar por la tabla USD/m² por zona. Multiplicar m² × USD/m² base, después aplicar ajustes.

2. Si NO hay comparables Tokko, NO bajes el precio por miedo. Usá la tabla de USD/m² que TIENE valores reales del mercado actual. La tabla es tu ancla — los comparables son confirmación adicional.

3. Si los comparables Tokko vienen MUY por debajo de la tabla, probablemente esos comparables son:
   - propiedades en peor zona dentro del mismo barrio
   - estados peores
   - departamentos viejos/sin reciclar
   Confiá MÁS en la tabla que en comparables fuera de rango.

4. Una propiedad bien tasada en Mar del Plata mayo 2026 debería estar al precio MEDIO-ALTO de la tabla, no al MEDIO-BAJO. El mercado subió 12-15% en últimos 12 meses.

5. El RANGO low-high debe diferir 5-8%, NO 10%+. Diferencias mayores transmiten inseguridad al cliente.

6. Estimá días de venta:
   - Bien tasado dentro de la tabla: 30-60 días
   - 5% por encima de la tabla: 60-90 días
   - 10%+ por encima: 120-180 días

7. NUNCA digas en el razonamiento "no hay comparables suficientes" o "se sugiere validar antes de publicar". Eso desmotiva al cliente y resta credibilidad. Si tenés dudas, expresalas internamente pero presentá un rango decidido.

8. Razonamiento ESPECÍFICO citando metodología:
   - "Plaza Mitre tiene un USD/m² de 1.800-2.300 para usado. 70 m² × USD 2.000 = USD 140K. Ajusto -7% por 40 años de antigüedad sin reciclar = USD 130K. Rango USD 128-138K."
   - NO digas "se aplica un premium conservador" sin números concretos.

═══════════════════════════════════════════════════════════
OUTPUT ESTRICTO en JSON, sin markdown:
═══════════════════════════════════════════════════════════
{
  "suggested_price_low_usd": 128000,
  "suggested_price_high_usd": 138000,
  "ai_reasoning": "Plaza Mitre tiene un USD/m² de 1.800-2.300 para usado en buen estado. Para 70 m² eso da USD 126-161K base. Tu propiedad: 40 años de antigüedad sin reciclar (-10%), sin vista (-0%), 3 amb 2 dormitorios al frente con balcón y ascensor (+5% por orientación al frente y luminosidad). Resultado: USD 128-138K. La ausencia de cochera resta atractivo pero el barrio compensa.",
  "market_summary": "Plaza Mitre / Plaza Colón se mantiene como zona premium dentro del centro de MdP, con demanda activa para 2-3 ambientes. El rango actual es USD 1.800-2.300/m² para usado y trepa a USD 2.300-2.700/m² para reciclados. El mercado se reactivó en 2025 con la vuelta de los créditos hipotecarios y los valores subieron 12-15% en el último año.",
  "recommendations": [
    "Publicar en USD 138K para tener margen de negociación al cierre real de USD 130K",
    "Sesión fotográfica profesional destacando la luminosidad y los ambientes al frente",
    "Filmar tour de 60 segundos en Reels de Instagram",
    "Súper destaque Premier en Zonaprop, Argenprop y Mercado Libre simultáneamente",
    "Aceptar ofertas serias desde USD 125K"
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
    }).filter((x): x is { score: number; comp: Comparable } => x !== null && x.score >= 15);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 8).map(s => s.comp);
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
      max_tokens: 1800,
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
