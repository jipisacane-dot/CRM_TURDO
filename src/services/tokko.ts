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

// ── API calls ─────────────────────────────────────────────────────────────────

const get = async <T>(resource: string, params: Record<string, string> = {}): Promise<T> => {
  const qs = new URLSearchParams({ key: API_KEY, format: 'json', lang: 'es_ar', ...params });
  const res = await fetch(`${BASE}/${resource}/?${qs}`);
  if (!res.ok) throw new Error(`Tokko API error ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
};

export const tokko = {
  /** Fetch all properties — auto-paginates until all are loaded */
  async getProperties(): Promise<CRMProperty[]> {
    const PAGE = 100;
    const first = await get<TokkoListResponse>('property', { limit: String(PAGE), offset: '0' });
    const total = first.meta.total_count;
    const all: TokkoProperty[] = [...first.objects];

    // Fetch remaining pages in parallel
    if (total > PAGE) {
      const pages = Math.ceil((total - PAGE) / PAGE);
      const rest = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          get<TokkoListResponse>('property', { limit: String(PAGE), offset: String((i + 1) * PAGE) })
        )
      );
      rest.forEach(r => all.push(...r.objects));
    }

    return all.map(normalize);
  },

  /** Fetch single property by ID */
  async getProperty(id: number): Promise<CRMProperty> {
    const qs = new URLSearchParams({ key: API_KEY, format: 'json', lang: 'es_ar' });
    const res = await fetch(`${BASE}/property/${id}/?${qs}`);
    if (!res.ok) throw new Error(`Tokko API error ${res.status}`);
    const data = await res.json() as TokkoProperty;
    return normalize(data);
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
