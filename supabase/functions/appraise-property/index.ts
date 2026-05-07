// Tasación de propiedad con IA — motor "comparables-first":
// 1) Busca propiedades comparables en Tokko + Mercado Libre (mismo barrio, ±25% m², ±1 amb)
// 2) Calcula USD/m² mediano de los comparables
// 3) Claude Sonnet 4.6 razona el precio AJUSTADO con factores específicos (vista, antigüedad, amueblado, etc.)
// 4) Retorna {suggested_price_low_usd, suggested_price_high_usd, comparables, ai_reasoning, market_summary, recommendations, estimated_sale_days}

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
  is_furnished?: boolean;
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

// ── Tokko ─────────────────────────────────────────────────────────────────
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
      if (price < 30000 || price > 1000000) return null;

      const m2 = Number(p.surface ?? p.total_surface ?? 0);
      if (m2 < 15 || m2 > 500) return null;

      const location = (p.location as Record<string, unknown>) ?? {};
      const barrio = String(location.name ?? '').toLowerCase();
      const address = String(p.address ?? '');
      const rooms = Number(p.room_amount ?? 0);

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
    return scored.slice(0, 10).map(s => s.comp);
  } catch (e) {
    console.error('Tokko search err', e);
    return [];
  }
}

// ── Mercado Libre Inmuebles (API pública) ──────────────────────────────────
// MLA1459 = Inmuebles. Filtros: Mar del Plata, departamento, venta, USD.
async function findMLComparables(input: PropertyInput): Promise<Comparable[]> {
  if (!input.barrio) return [];
  try {
    const targetM2 = input.surface_m2 ?? input.surface_total_m2 ?? 0;
    const targetRooms = input.rooms ?? 0;

    // Búsqueda por texto: barrio + Mar del Plata + departamento. Filtramos en código.
    const q = `${input.barrio} mar del plata departamento ${targetRooms ? `${targetRooms} ambientes` : ''}`.trim();
    const url = `https://api.mercadolibre.com/sites/MLA/search?category=MLA1459&q=${encodeURIComponent(q)}&limit=50&offset=0`;

    const r = await fetch(url);
    if (!r.ok) {
      console.warn('ML search failed', r.status);
      return [];
    }
    const j = await r.json();
    const items = (j.results ?? []) as Array<Record<string, unknown>>;

    const targetBarrio = (input.barrio ?? '').toLowerCase();

    const scored = items.map(item => {
      // Solo USD
      if (item.currency_id !== 'USD') return null;
      const price = Number(item.price ?? 0);
      if (price < 30000 || price > 1500000) return null;

      // Atributos
      const attrs = (item.attributes ?? []) as Array<Record<string, unknown>>;
      const findAttr = (id: string): number => {
        const a = attrs.find(x => x.id === id);
        if (!a) return 0;
        const v = String(a.value_name ?? '').replace(/[^0-9.]/g, '');
        return Number(v) || 0;
      };
      const findAttrText = (id: string): string => {
        const a = attrs.find(x => x.id === id);
        return a ? String(a.value_name ?? '') : '';
      };
      const m2 = findAttr('TOTAL_AREA') || findAttr('COVERED_AREA') || 0;
      const rooms = findAttr('ROOMS');
      const condition = findAttrText('PROPERTY_CONDITION') || findAttrText('CONDITION') || '';

      if (m2 < 15 || m2 > 500) return null;
      if (targetM2 > 0 && Math.abs(m2 - targetM2) / targetM2 > 0.5) return null;

      // Filtrar Mar del Plata vía address.city_name (a veces viene "Mar Del Plata", "MdP", etc)
      const address = (item.address as Record<string, unknown>) ?? {};
      const city = String(address.city_name ?? '').toLowerCase();
      const titleLower = String(item.title ?? '').toLowerCase();
      if (!city.includes('mar del plata') && !titleLower.includes('mar del plata') && !titleLower.includes('mdp')) return null;

      let score = 0;
      const neighborhood = String(address.neighborhood ?? '').toLowerCase();
      if (targetBarrio) {
        const barrioFirst = targetBarrio.split(' ')[0];
        if (neighborhood.includes(barrioFirst)) score += 50;
        else if (titleLower.includes(targetBarrio)) score += 35;
      }
      if (targetRooms > 0 && rooms === targetRooms) score += 25;
      else if (targetRooms > 0 && Math.abs(rooms - targetRooms) === 1) score += 10;
      if (targetM2 > 0) {
        const diff = Math.abs(m2 - targetM2) / targetM2;
        if (diff < 0.15) score += 25;
        else if (diff < 0.30) score += 12;
      }

      return {
        score,
        comp: {
          source: 'MercadoLibre',
          address: String(address.address_line ?? item.title ?? 'MdP').slice(0, 80),
          barrio: String(address.neighborhood ?? input.barrio ?? ''),
          price_usd: price,
          m2,
          rooms: rooms || undefined,
          state: condition || undefined,
          link: String(item.permalink ?? ''),
        } as Comparable,
      };
    }).filter((x): x is { score: number; comp: Comparable } => x !== null && x.score >= 25);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10).map(s => s.comp);
  } catch (e) {
    console.error('ML search err', e);
    return [];
  }
}

// ── Slugify para URLs de portales ──────────────────────────────────────────
function slugifyBarrio(b: string): string {
  return b.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove diacritics
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// ── Argenprop scraping (HTML cards parsed con regex) ───────────────────────
async function findArgenpropComparables(input: PropertyInput): Promise<Comparable[]> {
  if (!input.barrio) return [];
  const slug = slugifyBarrio(input.barrio);
  if (!slug) return [];

  const url = `https://www.argenprop.com/departamento-venta-localidad-mar-del-plata-barrio-${slug}`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9',
      },
    });
    if (!r.ok) return [];
    const html = await r.text();

    // Parsear cards: cada listing está en <a id="id-card-N" class="card ...">...</a>
    const cards = html.split(/<a\s[^>]*id="id-card-\d+"/);
    const targetM2 = input.surface_m2 ?? input.surface_total_m2 ?? 0;
    const targetRooms = input.rooms ?? 0;

    const comps: Comparable[] = [];
    for (const card of cards.slice(1)) {
      // Precio: <p class="card__price"> <span class="card__currency">USD</span> 59.900 </p>
      // El número viene DESPUÉS del </span>, no inmediatamente.
      const priceBlock = card.match(/class="card__price"[^>]*>([\s\S]{0,400}?)<\/p>/);
      if (!priceBlock) continue;
      const priceInner = priceBlock[1];
      if (!/USD|U\$S|U\$D/i.test(priceInner)) continue;
      const priceM = priceInner.match(/<\/span>\s*([\d.,]+)/) || priceInner.match(/([\d.,]+)\s*$/);
      if (!priceM) continue;
      const price = Number(priceM[1].replace(/[^\d]/g, ''));
      if (price < 25000 || price > 1500000) continue;

      // Address
      const addrM = card.match(/class="card__address"[^>]*>\s*([^<]+)/);
      const address = addrM
        ? addrM[1].trim().replace(/&[a-z#0-9]+;/gi, '').replace(/\s+/g, ' ').slice(0, 80)
        : `${input.barrio} (Argenprop)`;

      // Title — para detectar estado y monoambiente
      const titleM = card.match(/class="card__title"[^>]*>\s*([^<]+)/);
      const titleP = card.match(/class="card__title--primary"[^>]*>\s*([^<]+)/);
      const titleText = ((titleM?.[1] ?? '') + ' ' + (titleP?.[1] ?? '')).toLowerCase();
      let state: string | undefined;
      if (titleText.includes('a estrenar') || titleText.includes('estrenar')) state = 'A estrenar';
      else if (titleText.includes('reciclad')) state = 'Reciclado';
      else if (titleText.includes('refaccion') || titleText.includes('regular')) state = 'Usado regular';
      else state = 'Usado';

      // Description (card__info) — donde Argenprop pone m², ambientes, expensas
      const infoM = card.match(/class="card__info[^"]*"[^>]*>([\s\S]{0,3000}?)<\/p>/);
      const infoText = (infoM?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');

      // m² — buscar en title, description y features
      let m2 = 0;
      // Patrones: "X m²", "X m2", "Xm2", "X mts", "superficie cubierta: X"
      const m2Patterns = [
        /superficie\s+cubierta[:\s]+(\d+)/i,
        /(\d+)\s*m[²2]\s*cubiertos?/i,
        /(\d+)\s*m[²2]/i,
        /(\d+)\s*mts?/i,
      ];
      const haystack = infoText + ' ' + titleText;
      for (const re of m2Patterns) {
        const x = haystack.match(re);
        if (x) { m2 = Number(x[1]); break; }
      }

      // Ambientes
      let rooms = 0;
      if (titleText.includes('monoambiente') || titleText.includes('mono ambiente')) rooms = 1;
      else {
        const ambX = haystack.match(/(\d+)\s*ambientes?/i);
        if (ambX) rooms = Number(ambX[1]);
      }

      // Antigüedad (opcional)
      let age: number | undefined;
      const ageX = haystack.match(/antig[üu]edad[:\s]+(\d+)/i) || haystack.match(/(\d+)\s*a[ñn]os de antig/i);
      if (ageX) age = Number(ageX[1]);

      if (m2 < 15 || m2 > 500) continue;
      // Filtro generoso de m² — muchos cards de Argenprop no tienen m² claro, mejor traer más y dejar que la mediana filtre outliers
      if (targetM2 > 0 && Math.abs(m2 - targetM2) / targetM2 > 0.8) continue;

      let score = 40; // ya viene del barrio correcto por URL
      if (targetRooms > 0 && rooms === targetRooms) score += 30;
      else if (targetRooms > 0 && Math.abs(rooms - targetRooms) === 1) score += 12;
      if (targetM2 > 0) {
        const diff = Math.abs(m2 - targetM2) / targetM2;
        if (diff < 0.15) score += 30;
        else if (diff < 0.30) score += 15;
        else if (diff < 0.50) score += 5;
      }
      // threshold más flexible: si cumple barrio + m² razonable, ya cuenta
      if (score < 40) continue;

      comps.push({
        source: 'Argenprop',
        address,
        barrio: input.barrio,
        price_usd: price,
        m2,
        rooms: rooms || undefined,
        state,
        age,
      });
    }

    // Ordenar por similaridad (heurística: cerca a target_m2)
    if (targetM2 > 0) {
      comps.sort((a, b) => Math.abs(a.m2 - targetM2) - Math.abs(b.m2 - targetM2));
    }
    return comps.slice(0, 12);
  } catch (e) {
    console.error('AP scrape err', e);
    return [];
  }
}

async function findZonaPropComparables(input: PropertyInput): Promise<Comparable[]> {
  // Mantenido por compatibilidad pero Cloudflare bloquea (403). Argenprop reemplaza.
  if (!input.barrio) return [];
  const slug = slugifyBarrio(input.barrio);
  if (!slug) return [];

  // URL patterns ZP: {barrio}-mar-del-plata + ambientes opcional
  const ambSegment = input.rooms ? `-${input.rooms}-ambiente${input.rooms > 1 ? 's' : ''}` : '';
  const urls = [
    `https://www.zonaprop.com.ar/departamentos-venta-${slug}-mar-del-plata${ambSegment}.html`,
    `https://www.zonaprop.com.ar/departamentos-venta-${slug}-mar-del-plata.html`,
  ];

  const targetM2 = input.surface_m2 ?? input.surface_total_m2 ?? 0;
  const targetRooms = input.rooms ?? 0;

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-AR,es;q=0.9',
        },
      });
      if (!r.ok) continue;
      const html = await r.text();
      const m = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
      if (!m) continue;
      let state: Record<string, unknown>;
      try { state = JSON.parse(m[1]); } catch { continue; }

      const listStore = (state.listStore as Record<string, unknown>) ?? {};
      const postings = (listStore.listPostings as Array<Record<string, unknown>>) ?? [];
      if (postings.length === 0) continue;

      const scored = postings.map(p => {
        // Precio USD
        const ops = (p.priceOperationTypes as Array<Record<string, unknown>>) ?? [];
        const sale = ops[0];
        if (!sale) return null;
        const prices = (sale.prices as Array<Record<string, unknown>>) ?? [];
        const usd = prices.find(pr => pr.currency === 'USD');
        if (!usd) return null;
        const price = Number(usd.amount ?? 0);
        if (price < 25000 || price > 1500000) return null;

        // Features
        const feats = (p.mainFeatures as Record<string, Record<string, unknown>>) ?? {};
        const m2Cubierta = Number((feats.CFT101?.value ?? '').toString().replace(/[^0-9.]/g, '')) || 0;
        const m2Total = Number((feats.CFT100?.value ?? '').toString().replace(/[^0-9.]/g, '')) || 0;
        const m2 = m2Cubierta || m2Total;
        const rooms = Number((feats.CFT1?.value ?? '').toString().replace(/[^0-9.]/g, '')) || 0;

        if (m2 < 15 || m2 > 500) return null;
        if (targetM2 > 0 && Math.abs(m2 - targetM2) / targetM2 > 0.5) return null;

        // Address
        const postingLocation = (p.postingLocation as Record<string, unknown>) ?? {};
        const location = (postingLocation.location as Record<string, unknown>) ?? {};
        const addressLine = String(p.address ?? location.name ?? '').slice(0, 80);
        const title = String(p.generatedTitle ?? p.title ?? '').slice(0, 80);
        const barrio = String(location.parent?.name ?? location.name ?? input.barrio ?? '');

        // State del título (heurística: "Reciclado", "A estrenar")
        const titleLower = (String(p.title ?? '') + ' ' + title).toLowerCase();
        let state2: string | undefined;
        if (titleLower.includes('a estrenar') || titleLower.includes('estrenar')) state2 = 'A estrenar';
        else if (titleLower.includes('reciclad')) state2 = 'Reciclado';
        else if (titleLower.includes('refaccion') || titleLower.includes('regular')) state2 = 'Usado regular';
        else state2 = 'Usado';

        // Antigüedad si está en features
        const age = Number((feats.CFT2?.value ?? '').toString().replace(/[^0-9.]/g, '')) || undefined;

        let score = 0;
        // Match barrio (siempre por URL ya, así que score base alto)
        score += 40;
        if (targetRooms > 0 && rooms === targetRooms) score += 30;
        else if (targetRooms > 0 && Math.abs(rooms - targetRooms) === 1) score += 12;
        if (targetM2 > 0) {
          const diff = Math.abs(m2 - targetM2) / targetM2;
          if (diff < 0.15) score += 30;
          else if (diff < 0.30) score += 15;
        }

        return {
          score,
          comp: {
            source: 'ZonaProp',
            reference_code: String(p.postingCode ?? p.postingId ?? ''),
            address: addressLine || title || `${barrio} (ZP)`,
            barrio,
            price_usd: price,
            m2,
            rooms: rooms || undefined,
            state: state2,
            age,
            link: `https://www.zonaprop.com.ar${(p.url as string) ?? '/'}`,
          } as Comparable,
        };
      }).filter((x): x is { score: number; comp: Comparable } => x !== null && x.score >= 40);

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 12).map(s => s.comp);
    } catch (e) {
      console.error('ZP scrape err', url, e);
      continue;
    }
  }
  return [];
}

// ── Combinador: dedupe por dirección+m²+precio ─────────────────────────────
function combineComparables(...lists: Comparable[][]): Comparable[] {
  const seen = new Set<string>();
  const merged: Comparable[] = [];
  for (const list of lists) {
    for (const c of list) {
      const key = `${c.address.toLowerCase().trim().slice(0, 30)}_${c.m2}_${Math.round(c.price_usd / 1000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(c);
    }
  }
  return merged.slice(0, 18);
}

// ── Histórico de correcciones del equipo Turdo ─────────────────────────────
// Compara lo que la IA sugirió con lo que el agente terminó publicando, en
// tasaciones previas del mismo perfil. Si hay un sesgo sistemático (la IA
// subestima en este barrio), el modelo lo aprende.
async function loadCorrectionHistory(input: PropertyInput): Promise<{ avgPct: number; n: number; minPct: number; maxPct: number } | null> {
  if (!input.barrio) return null;
  try {
    const { data } = await sb
      .from('appraisals')
      .select('rooms, surface_m2, ai_suggested_high_usd, suggested_price_high_usd, property_state')
      .ilike('barrio', `%${input.barrio.split(' ')[0]}%`)
      .not('ai_suggested_high_usd', 'is', null)
      .gt('ai_suggested_high_usd', 0)
      .order('created_at', { ascending: false })
      .limit(40);

    if (!data || data.length === 0) return null;

    const targetRooms = input.rooms ?? 0;
    const targetM2 = input.surface_m2 ?? input.surface_total_m2 ?? 0;

    const matches = data.filter(r => {
      // Mismo perfil de tamaño (±1 amb, ±50% m²)
      if (targetRooms > 0 && Math.abs((r.rooms ?? 0) - targetRooms) > 1) return false;
      if (targetM2 > 0 && r.surface_m2) {
        const diff = Math.abs(r.surface_m2 - targetM2) / targetM2;
        if (diff > 0.6) return false;
      }
      return true;
    });

    if (matches.length < 3) return null;

    const corrections = matches.map(r => (r.suggested_price_high_usd - r.ai_suggested_high_usd) / r.ai_suggested_high_usd);
    const avg = corrections.reduce((s, x) => s + x, 0) / corrections.length;
    const min = Math.min(...corrections);
    const max = Math.max(...corrections);

    return { avgPct: avg * 100, n: matches.length, minPct: min * 100, maxPct: max * 100 };
  } catch (e) {
    console.error('history err', e);
    return null;
  }
}

// ── USD/m² estadística de comparables ──────────────────────────────────────
function calcStats(comps: Comparable[]): { median: number; min: number; max: number; n: number } {
  const ppms = comps.filter(c => c.m2 > 0 && c.price_usd > 0).map(c => c.price_usd / c.m2);
  if (ppms.length === 0) return { median: 0, min: 0, max: 0, n: 0 };
  ppms.sort((a, b) => a - b);
  const median = ppms.length % 2 === 0
    ? (ppms[ppms.length / 2 - 1] + ppms[ppms.length / 2]) / 2
    : ppms[(ppms.length - 1) / 2];
  return { median: Math.round(median), min: Math.round(ppms[0]), max: Math.round(ppms[ppms.length - 1]), n: ppms.length };
}

// ── Prompt: comparables-first ──────────────────────────────────────────────
const SYSTEM_PROMPT = `Sos un tasador inmobiliario senior con 15 años en Mar del Plata, Argentina. Trabajás para Turdo Estudio Inmobiliario. La fecha es mayo 2026.

═══════════════════════════════════════════════════════════
METODOLOGÍA — COMPARABLES PRIMERO, NÚMEROS REALES
═══════════════════════════════════════════════════════════

Tu trabajo es producir una tasación PRECISA basada en COMPARABLES REALES del mercado actual (Argenprop, MercadoLibre, Tokko). NO inventes precios. Trabajá con los datos que te llegan.

═══════════════════════════════════════════════════════════
TABLA USD/m² REAL (mayo 2026, datos verificados ZonaProp/Argenprop)
═══════════════════════════════════════════════════════════
USAR SOLO si NO hay comparables suficientes. Si hay ≥3 comparables, ignorá la tabla y trabajá con su mediana.

⚠ CRÍTICO: monoambientes y deptos chicos tienen USD/m² MUCHO MÁS ALTO que deptos grandes. La tabla está separada por TAMAÑO.

──────────────────────────────────────────────────────────
MONOAMBIENTES (15-30 m²) — el tipo más caro por m²
──────────────────────────────────────────────────────────
ZONA                                | USADO       | RECICLADO/A ESTRENAR
Stella Maris / Playa Grande         | 2.500-3.000 | 3.000-3.700
Plaza Mitre / Plaza Colón           | 2.000-2.500 | 2.500-3.000
La Perla / Centro / Los Troncos     | 1.800-2.300 | 2.300-2.800
Plaza España / Av. Alem             | 1.700-2.100 | 2.100-2.500
Macrocentro                         | 1.300-1.700 | 1.700-2.100

──────────────────────────────────────────────────────────
DEPTOS 2 AMBIENTES (30-55 m²)
──────────────────────────────────────────────────────────
Stella Maris / Playa Grande         | 2.300-2.700 | 2.700-3.200
Plaza Mitre / Plaza Colón           | 1.800-2.300 | 2.300-2.700
La Perla / Centro / Los Troncos     | 1.600-2.000 | 2.000-2.400
Plaza España / Av. Alem             | 1.500-1.800 | 1.800-2.200
Macrocentro                         | 1.200-1.500 | 1.500-1.800

──────────────────────────────────────────────────────────
DEPTOS 3+ AMBIENTES (55-120 m²)
──────────────────────────────────────────────────────────
Stella Maris / Playa Grande         | 2.100-2.500 | 2.500-3.000
Plaza Mitre / Plaza Colón           | 1.700-2.100 | 2.100-2.500
La Perla / Centro / Los Troncos     | 1.500-1.800 | 1.800-2.100
Plaza España / Av. Alem             | 1.300-1.700 | 1.700-2.000
Macrocentro                         | 1.100-1.400 | 1.400-1.700

──────────────────────────────────────────────────────────
ZONAS PERIFÉRICAS (todos los tamaños)
──────────────────────────────────────────────────────────
Punta Mogotes / B. Peralta Ramos    | 1.000-1.300 | 1.300-1.700
Norte (Constitución 5000+)          | 900-1.300   | 1.300-1.600
Constitución alejada / Don Bosco    | 800-1.100   | 1.100-1.400

⚠ SI EL DEPTO ES MONOAMBIENTE en La Perla/Centro RECICLADO de 24-28 m²: rango USD 2.300-2.800/m² → 24m² × 2.500 = USD 60K base. NO USAR USD 1.300/m² (ese es el rango usado de deptos grandes).

PASO 1 — Calculá el USD/m² de los comparables y eliminá outliers:
  • Tomá la mediana de USD/m² de los comparables que te paso
  • Descartá los que estén >35% por arriba o por debajo de la mediana (suelen ser pifies de carga)
  • Si quedan <3 comparables válidos: usá la TABLA por TAMAÑO (mono / 2 amb / 3+) — NO la mezcles con valores de otro tamaño

PASO 2 — Aplicá la mediana al m² del depto a tasar:
  base_USD = m² × USD/m² mediano de comparables válidos

  ⚠ Si los comparables son de TAMAÑO distinto (ej: el depto es monoambiente pero los comparables son 2-3 amb), su USD/m² te puede subestimar. Aplicá una corrección: para monoambientes vs 2 amb, sumar +15-20%. Para monoambientes vs 3+ amb, sumar +25-30%.

PASO 3 — Aplicá ajustes específicos sobre el base_USD:

  AJUSTES POSITIVOS:
  +15-25%   Vista directa al mar (verificada)
  +8-12%    Vista lateral al mar
  +8-12%    Cochera incluida en zona central
  +5-10%    Edificio con amenities (piscina, SUM, parrilla)
  +5-8%     Balcón generoso al frente
  +5%       Piso alto (5°+) sin contrafrente
  +5-10%    🟡 AMUEBLADO en reciclado o a estrenar (común en MdP en cuadra zonas turísticas — premium real)
  +3-5%     Mascotas permitidas

  AJUSTES NEGATIVOS:
  -10-15%   Antigüedad 30-50 años en estado original
  -12-18%   Antigüedad 51-70 años (incluso si está reciclado)
  -18-25%   Antigüedad 71+ años
  -8-12%    Sin balcón
  -5-10%    Contrafrente
  -5-10%    Expensas altas (>5% del valor mensual / >5% precio anual)
  -15-20%   Estado regular / requiere refacción
  -5-8%     Sin cochera en zona central (Plaza Mitre, Plaza Colón, Centro)

  Recordá: los comparables ya tienen incorporados muchos de estos factores en su precio. NO doblés la penalización si los comparables son del mismo perfil. Aplicá ajustes solo cuando el depto a tasar es CLARAMENTE distinto a la mediana (ej: comparables son a estrenar y este es usado original).

PASO 4 — Rango low-high:
  • diferencia 5-7% entre low y high (low = precio firme de cierre, high = precio publicación con margen)
  • NUNCA más de 7% — diferencias mayores transmiten inseguridad

PASO 5 — Días estimados de venta:
  • Bien tasado en mediana: 30-60 días
  • 5% por encima: 60-90 días
  • 10%+ por encima: 120-180 días

PASO 6 — CHECK FINAL:
  • USD/m² del precio sugerido cae dentro del rango de los comparables válidos? Sí ✓
  • Penalizaciones de antigüedad / falta de amenities aplicadas si correspondía? Sí ✓
  • Bonus de amueblado aplicado si corresponde? Sí ✓
  • Diferencia low-high entre 5-7%? Sí ✓

═══════════════════════════════════════════════════════════
DOS TEXTOS DISTINTOS — IMPORTANTE
═══════════════════════════════════════════════════════════

**recommendations** = LISTA DE 4-5 ACCIONES DE MARKETING / ESTRATEGIA, sin montos USD
  - ⚠ NUNCA incluyas precios específicos (USD X, $X, X mil) en las recomendaciones — los montos se generan automáticamente y se prependen al renderizar.
  - Recomendaciones válidas: qué destacar en el aviso, qué fotos sacar, en qué portales publicar y con qué nivel, cómo coordinar visitas, qué público objetivo apuntar.
  - Recomendaciones inválidas (NO HACER): "Publicar en USD X", "Aceptar ofertas desde Y", "Cierre en Z" — esas las genera el sistema con los precios actualizados.

**ai_reasoning** = TEXTO PARA EL CLIENTE FINAL (lo va a leer el dueño del depto en su informe)
  - Tono: profesional, cálido, claro. Como un asesor inmobiliario senior explicando.
  - 3-4 párrafos cortos en lenguaje natural.
  - SIN: "outlier", "depuración", "mediana bruta", "umbral de corte", "comparable eliminado", "+33%/-43%", referencias técnicas crudas.
  - SÍ: explicación del barrio y su demanda, mención de que se analizaron N propiedades similares, descripción de los factores que suman/restan al precio (vista, antigüedad, amenities, etc.) en términos COMERCIALES, conclusión con confianza.
  - Ejemplo CORRECTO: "El barrio Plaza Mitre es una de las zonas más demandadas del centro de Mar del Plata. Para tasar tu propiedad analizamos 12 deptos similares actualmente publicados en la zona. La antigüedad del edificio (35 años, sin reciclar) y la ausencia de cochera ajustan el precio respecto al promedio del barrio, mientras que el balcón al frente y la buena orientación lo posicionan favorablemente. El rango sugerido contempla un margen razonable para negociación en el cierre."

**calculation_breakdown** = TEXTO PARA EL AGENTE / USO INTERNO (no se muestra al cliente)
  - Tono: técnico, con números explícitos.
  - Mostrá: depuración de outliers, mediana de comparables, cálculo base, cada ajuste con su porcentaje y monto USD.
  - Ejemplo: "12 comparables válidos en Plaza Mitre. Mediana USD/m²: 2.080. Base: 70m² × 2.080 = USD 145.600. Ajustes: -8% sin cochera (-USD 11.648); -5% antigüedad 35 años (-USD 7.280); +6% balcón al frente (+USD 8.736). Total: USD 135.408 → rango USD 132K-140K."

NUNCA digas en ai_reasoning "no hay comparables suficientes" o "se sugiere validar antes de publicar". Si tenés ≥3 comparables, presentá un rango decidido. Si tenés <3, igual presentá rango con confianza.

═══════════════════════════════════════════════════════════
OUTPUT ESTRICTO en JSON, sin markdown:
═══════════════════════════════════════════════════════════
{
  "suggested_price_low_usd": 132000,
  "suggested_price_high_usd": 140000,
  "ai_reasoning": "El barrio Plaza Mitre se mantiene como una de las zonas más demandadas del centro de Mar del Plata, con buena rotación para 2-3 ambientes y demanda sostenida desde la vuelta del crédito hipotecario en 2025.\\n\\nPara tasar tu propiedad analizamos 12 deptos similares actualmente publicados en la zona. La antigüedad del edificio (35 años, sin reciclar) y la ausencia de cochera resta atractivo respecto al promedio del barrio, mientras que el balcón al frente y la buena orientación lo posicionan favorablemente.\\n\\nEl rango sugerido contempla un margen razonable para negociación: el valor superior es el precio de publicación recomendado y el inferior, el cierre esperado en una operación con buen interés.",
  "calculation_breakdown": "12 comparables válidos en Plaza Mitre. Mediana USD/m²: 2.080. Base: 70m² × 2.080 = USD 145.600. Ajustes: -8% sin cochera (-USD 11.648); -5% antigüedad 35 años no reciclado (-USD 7.280); +6% balcón al frente (+USD 8.736). Total: USD 135.408 → rango USD 132K-140K (margen 5.7%).",
  "market_summary": "Plaza Mitre mantiene USD/m² entre USD 1.800 y USD 2.300 para usados al cierre de 2025-2026, con una suba acumulada del 12-15% en el último año.",
  "recommendations": [
    "Destacar en el aviso la orientación al frente y la luminosidad — son el diferenciador real frente a la competencia del barrio",
    "Sesión fotográfica profesional en horario de mejor luz natural",
    "Filmar tour de 60 segundos en Reels Instagram + video tour completo en YouTube",
    "Activar Súper Premier en Zonaprop, Argenprop y MercadoLibre simultáneamente desde el día 1",
    "Coordinar visitas concentradas en horarios de luz para mostrar la orientación"
  ],
  "estimated_sale_days": 50
}`;

async function callClaude(propertyData: PropertyInput, comparables: Comparable[], stats: ReturnType<typeof calcStats>, history: Awaited<ReturnType<typeof loadCorrectionHistory>>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reason: string; raw?: string }> {
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
- Amueblado: ${propertyData.is_furnished ? '🟡 SÍ — aplicar bonus de +5-10% si es reciclado o a estrenar' : 'No'}
- Amenities: ${(propertyData.amenities ?? []).join(', ') || 'Ninguno destacado'}
- Expensas: ${propertyData.expenses_ars ? `ARS ${propertyData.expenses_ars}` : '?'}
- Notas: ${propertyData.notes ?? '(sin notas)'}
`;

  const compsText = comparables.length > 0
    ? `COMPARABLES DEL MERCADO (${comparables.length} totales — Tokko + MercadoLibre):
${comparables.map((c, i) => {
  const ppm = c.m2 ? Math.round(c.price_usd / c.m2) : 0;
  return `${i + 1}. [${c.source}] ${c.address} (${c.barrio || '?'}) — USD ${c.price_usd.toLocaleString()} | ${c.m2} m² | USD/m² ${ppm} | ${c.rooms ?? '?'} amb | ${c.state ?? '?'} | ${c.age ? c.age + ' años' : 'edad ?'}`;
}).join('\n')}

ESTADÍSTICAS USD/m² de comparables: mediana USD ${stats.median} · min USD ${stats.min} · max USD ${stats.max} · n=${stats.n}`
    : 'COMPARABLES: 0 encontrados en Tokko ni MercadoLibre. Tasación basada en conocimiento general del mercado MdP — aclaralo brevemente.';

  const historyText = history
    ? `\nHISTÓRICO DE CORRECCIONES TURDO en este perfil (${history.n} tasaciones previas, mismo barrio + tamaño similar):
- Ajuste promedio del agente sobre la IA: ${history.avgPct >= 0 ? '+' : ''}${history.avgPct.toFixed(1)}%
- Rango de ajustes: ${history.minPct.toFixed(1)}% a +${history.maxPct.toFixed(1)}%

⚠ Esto es SEÑAL DEL MERCADO REAL: si los agentes ajustan sistemáticamente +X% sobre tu sugerencia en este barrio, significa que estás subvaluando. Aplicá ese sesgo a tu cálculo. Si el ajuste promedio es <±3%, ignoralo (ruido).`
    : '';

  const userPrompt = `${propText}\n${compsText}${historyText}\n\nGenerá la tasación en el formato JSON pedido. Mostrá los números del cálculo en calculation_breakdown.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('Claude err', resp.status, errText);
    return { ok: false, reason: `Claude HTTP ${resp.status}: ${errText.slice(0, 300)}` };
  }

  const data = await resp.json();
  const text: string = data?.content?.[0]?.text ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, reason: 'no JSON in response', raw: text.slice(0, 500) };
  try {
    return { ok: true, data: JSON.parse(m[0]) };
  } catch (e) {
    return { ok: false, reason: `JSON parse: ${(e as Error).message}`, raw: m[0].slice(0, 500) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: {
    property?: PropertyInput;
    agent_id?: string;
    agent_email?: string;
    contact_id?: string;
    client?: { name?: string; email?: string; phone?: string };
    photos?: Array<{ url: string; caption?: string }>;
    save?: boolean;
  };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { property, agent_id, agent_email, contact_id, client, photos = [], save = true } = body;
  if (!property?.address) {
    return new Response(JSON.stringify({ error: 'property.address required' }), { status: 400, headers: CORS });
  }

  // 1. Comparables: Tokko + ML + Argenprop + ZonaProp en paralelo
  // Argenprop primero porque es la fuente más completa (Cloudflare bloquea ZonaProp desde Supabase Edge).
  const [tokkoComps, mlComps, apComps, zpComps] = await Promise.all([
    findTokkoComparables(property),
    findMLComparables(property),
    findArgenpropComparables(property),
    findZonaPropComparables(property),
  ]);
  const comparables = combineComparables(apComps, zpComps, tokkoComps, mlComps);
  const stats = calcStats(comparables);

  // 1.5 Histórico de correcciones del equipo Turdo (aprendizaje)
  const history = await loadCorrectionHistory(property);

  // 2. IA tasa con comparables-first + histórico
  const aiResult = await callClaude(property, comparables, stats, history);
  if (!aiResult.ok) {
    return new Response(JSON.stringify({ error: 'AI service error', detail: aiResult.reason, raw: aiResult.raw }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const result = aiResult.data;

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

  // 4. Generar share_token único
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

  // 5. Guardar appraisal en DB
  let appraisalId: string | null = null;
  if (save && isUuid(resolvedAgentId)) {
    const { data: row, error } = await sb.from('appraisals').insert({
      contact_id: contact_id ?? null,
      agent_id: resolvedAgentId,
      share_token: shareToken,
      photos: photos,
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
      is_furnished: property.is_furnished ?? false,
      notes: property.notes ?? null,
      client_name: client?.name ?? null,
      client_email: client?.email ?? null,
      client_phone: client?.phone ?? null,
      suggested_price_low_usd: lowUsd,
      suggested_price_high_usd: highUsd,
      comparables: comparables,
      ai_reasoning: String(result.ai_reasoning ?? ''),
      calculation_breakdown: String(result.calculation_breakdown ?? ''),
      market_summary: String(result.market_summary ?? ''),
      recommendations: result.recommendations ?? [],
      estimated_sale_days: Number(result.estimated_sale_days ?? 0),
    }).select('id').single();
    if (!error) appraisalId = row?.id ?? null;
  }

  return new Response(JSON.stringify({
    appraisal_id: appraisalId,
    share_token: shareToken,
    suggested_price_low_usd: lowUsd,
    suggested_price_high_usd: highUsd,
    comparables,
    ai_reasoning: result.ai_reasoning,
    calculation_breakdown: result.calculation_breakdown,
    market_summary: result.market_summary,
    recommendations: result.recommendations,
    estimated_sale_days: result.estimated_sale_days,
    comparables_stats: stats,
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
