// Tokko Broker API — https://developers.tokkobroker.com/

const API_KEY = import.meta.env.VITE_TOKKO_KEY ?? '';
const BASE = import.meta.env.DEV ? '/tokko-api' : 'https://www.tokkobroker.com/api/v1';

// ── Raw API types ─────────────────────────────────────────────────────────────

export interface TokkoPhoto {
  image: string;
  thumb: string;
  is_front_cover: boolean;
  order: number;
}

export interface TokkoLocation {
  id: number;
  name: string;
  full_location: string;
  parent_id?: number;
}

export interface TokkoOperation {
  operation_id: number;
  operation_type: string; // "Venta" | "Alquiler" | etc.
  prices: {
    price: number;      // Tokko sends price as number
    currency: string;
    period?: number;
    is_promotional?: boolean;
  }[];
}

export interface TokkoTag {
  id: number;
  name: string;
  name_en: string;
}

export interface TokkoProperty {
  id: number;
  reference_code: string;
  publication_title: string;
  address: string;
  fake_address: string;
  description: string;
  type: { id: number; name: string };
  status: number; // 1=active, 2=reserved, 3=sold/rented
  web_price: boolean;
  price: number;
  currency: string;
  suite_amount: number;
  room_amount: number;
  bathroom_amount: number;
  toilet_amount: number;
  parking_lot_amount: number;
  surface: string;
  roofed_surface: string;
  semiroofed_surface: string;
  location: TokkoLocation;
  operations: TokkoOperation[];
  photos: TokkoPhoto[];
  tags: TokkoTag[];
  branch?: { id: number; name: string };
  agent?: { id: number; first_name: string; last_name: string; email: string };
  created_at?: string;
  updated_at?: string;
}

export interface TokkoMeta {
  total_count: number;
  limit: number;
  offset: number;
  next: string | null;
  previous: string | null;
}

export interface TokkoListResponse {
  meta: TokkoMeta;
  objects: TokkoProperty[];
}

// ── Normalized type for the CRM ───────────────────────────────────────────────

export interface CRMProperty {
  id: string;
  tokkoId: number;
  referenceCode: string;
  title: string;
  address: string;
  description: string;
  type: string;
  operations: { type: string; price: number; currency: string }[];
  mainOperation: string;
  mainPrice: number;
  mainCurrency: string;
  rooms: number;
  bedrooms: number;
  bathrooms: number;
  parking: number;
  surface: string;
  roofedSurface: string;
  location: string;
  fullLocation: string;
  coverPhoto: string | null;
  photos: string[];
  status: 'active' | 'reserved' | 'sold';
  publicUrl: string;
  branch: string;
  agent: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Normalizer ────────────────────────────────────────────────────────────────

// Tokko status: 2=active/published, 3=reserved, 4=sold/rented (1=draft, unpublished)
const STATUS_MAP: Record<number, CRMProperty['status']> = {
  1: 'sold', 2: 'active', 3: 'reserved', 4: 'sold',
};

export const normalize = (p: TokkoProperty): CRMProperty => {
  const cover = p.photos.find(ph => ph.is_front_cover) ?? p.photos[0];
  const mainOp = p.operations[0];
  const mainPrice = mainOp?.prices[0];

  return {
    id: String(p.id),
    tokkoId: p.id,
    referenceCode: p.reference_code ?? '',
    title: p.publication_title ?? p.type?.name ?? 'Propiedad',
    address: p.fake_address || p.address || 'Dirección reservada',
    description: p.description ?? '',
    type: p.type?.name ?? 'Propiedad',
    operations: p.operations.map(op => ({
      type: op.operation_type,
      price: op.prices[0]?.price ?? 0,
      currency: op.prices[0]?.currency ?? 'USD',
    })),
    mainOperation: mainOp?.operation_type ?? '',
    mainPrice: mainPrice?.price ?? 0,
    mainCurrency: mainPrice?.currency ?? 'USD',
    rooms: p.room_amount ?? 0,
    bedrooms: p.suite_amount ?? 0,
    bathrooms: p.bathroom_amount ?? 0,
    parking: p.parking_lot_amount ?? 0,
    surface: p.surface ?? '',
    roofedSurface: p.roofed_surface ?? '',
    location: p.location?.name ?? '',
    fullLocation: p.location?.full_location ?? '',
    coverPhoto: cover?.image ?? null,
    photos: p.photos.map(ph => ph.image),
    status: STATUS_MAP[p.status] ?? 'active',
    publicUrl: (p as unknown as Record<string, string>).public_url ?? '',
    branch: p.branch?.name ?? '',
    agent: p.agent ? `${p.agent.first_name} ${p.agent.last_name}`.trim() : '',
    tags: p.tags?.map(t => t.name) ?? [],
    createdAt: p.created_at ?? '',
    updatedAt: p.updated_at ?? '',
  };
};

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'tokko_props_v3';
const CACHE_TTL = 60 * 60 * 1000;   // 60 min fresh
const CACHE_STALE = 6 * 60 * 60 * 1000; // up to 6h stale (serve instantly while refreshing)

interface CacheEntry { data: CRMProperty[]; ts: number }

const getCache = (): { data: CRMProperty[]; stale: boolean } | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as CacheEntry;
    const age = Date.now() - ts;
    if (age > CACHE_TTL + CACHE_STALE) { localStorage.removeItem(CACHE_KEY); return null; }
    return { data, stale: age > CACHE_TTL };
  } catch { return null; }
};

const setCache = (data: CRMProperty[]) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); }
  catch (e) {
    // QuotaExceeded — clear other caches and retry once
    if ((e as Error).name === 'QuotaExceededError') {
      try { localStorage.removeItem(CACHE_KEY); localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch {}
    }
  }
};

// In-flight dedup — avoid two getProperties() calls firing duplicate requests
let inflight: Promise<CRMProperty[]> | null = null;

// ── API calls ─────────────────────────────────────────────────────────────────

const get = async <T>(resource: string, params: Record<string, string> = {}): Promise<T> => {
  const qs = new URLSearchParams({ key: API_KEY, format: 'json', lang: 'es_ar', ...params });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${BASE}/${resource}/?${qs}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Tokko API error ${res.status}: ${res.statusText}`);
    return res.json() as Promise<T>;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Tokko tardó demasiado. Revisá tu conexión.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

export const tokko = {
  /** Fetch all properties — stale-while-revalidate cache (60 min TTL) */
  async getProperties(forceRefresh = false): Promise<CRMProperty[]> {
    const cached = !forceRefresh ? getCache() : null;

    // Return fresh cache immediately
    if (cached && !cached.stale) return cached.data;

    // Dedup concurrent callers
    if (inflight) return inflight;

    const fetchFresh = async (): Promise<CRMProperty[]> => {
      const PAGE = 250; // Tokko max page size
      // Fire first 3 pages speculatively in parallel — no waiting for meta.total_count
      const SPECULATIVE = 3;
      const firstBatch = await Promise.all(
        Array.from({ length: SPECULATIVE }, (_, i) =>
          get<TokkoListResponse>('property', {
            limit: String(PAGE),
            offset: String(i * PAGE),
            only_recents: 'false',
          }).catch(() => ({ meta: { total_count: 0, limit: PAGE, offset: 0, next: null, previous: null }, objects: [] }))
        )
      );

      const all: TokkoProperty[] = [];
      firstBatch.forEach(r => all.push(...r.objects));
      const total = firstBatch[0]?.meta.total_count ?? 0;

      // Fetch any remaining pages beyond the speculative batch
      const fetched = SPECULATIVE * PAGE;
      if (total > fetched) {
        const remaining = Math.ceil((total - fetched) / PAGE);
        const rest = await Promise.all(
          Array.from({ length: remaining }, (_, i) =>
            get<TokkoListResponse>('property', {
              limit: String(PAGE),
              offset: String((SPECULATIVE + i) * PAGE),
            }).catch(() => ({ meta: { total_count: 0, limit: PAGE, offset: 0, next: null, previous: null }, objects: [] }))
          )
        );
        rest.forEach(r => all.push(...r.objects));
      }

      // Dedup by id (speculative fetch could overshoot when total < SPECULATIVE*PAGE)
      const seen = new Set<number>();
      const unique = all.filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });

      const result = unique.map(normalize);
      setCache(result);
      return result;
    };

    // Stale cache: return it immediately and refresh in background
    if (cached?.stale) {
      inflight = fetchFresh().finally(() => { inflight = null; });
      inflight.catch(console.error);
      return cached.data;
    }

    // No cache: must wait for fresh data
    inflight = fetchFresh().finally(() => { inflight = null; });
    return inflight;
  },

  /** Fetch single property by ID — uses list cache if available */
  async getProperty(id: number): Promise<CRMProperty> {
    const cached = getCache();
    if (cached) {
      const found = cached.data.find(p => p.tokkoId === id);
      if (found) return found;
    }
    const qs = new URLSearchParams({ key: API_KEY, format: 'json', lang: 'es_ar' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${BASE}/property/${id}/?${qs}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Tokko API error ${res.status}`);
      const data = await res.json() as TokkoProperty;
      return normalize(data);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('Tokko tardó demasiado. Revisá tu conexión.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },

  /** Post a lead/contact inquiry to a property */
  async postLead(opts: {
    propertyId: number;
    name: string;
    email: string;
    phone?: string;
    message?: string;
  }): Promise<void> {
    const body = new FormData();
    body.append('api_key', API_KEY);
    body.append('publication_id', String(opts.propertyId));
    body.append('name', opts.name);
    body.append('mail', opts.email);
    if (opts.phone) body.append('cellphone', opts.phone);
    if (opts.message) body.append('comment', opts.message);
    await fetch(`${BASE}/contact/`, { method: 'POST', body });
  },

  hasKey: () => Boolean(API_KEY),
};
