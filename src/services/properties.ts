import { supabase } from './supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export type PropertyStatus = 'borrador' | 'disponible' | 'reservada' | 'vendida' | 'alquilada' | 'caida' | 'pausada';
export type OperationType = 'venta' | 'alquiler' | 'temporario';
export type PropertyType = 'departamento' | 'casa' | 'ph' | 'local' | 'cochera' | 'terreno' | 'quinta' | 'oficina' | 'galpon';
export type PropertyCondition = 'nuevo' | 'usado' | 'a_reciclar' | 'reciclado' | 'en_construccion' | 'a_estrenar';
export type PriceCurrency = 'USD' | 'ARS';

export interface DBProperty {
  id: string;
  internal_code: string | null;
  slug: string | null;
  address: string | null;
  description: string | null;
  rooms: number | null;
  surface_m2: number | null;
  surface_total_m2: number | null;
  list_price_usd: number | null;
  status: PropertyStatus;
  captador_id: string | null;
  fecha_consignacion: string | null;
  tokko_sku: string | null;
  notes: string | null;
  barrio: string | null;
  cover_photo_url: string | null;
  operation_type: OperationType;
  property_type: PropertyType;
  street: string | null;
  street_number: string | null;
  floor: string | null;
  apartment_letter: string | null;
  city: string;
  province: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  price_currency: PriceCurrency;
  expenses_ars: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garage: number | null;
  age_years: number | null;
  orientation: string | null;
  condition: PropertyCondition;
  amenities: string[];
  is_published: boolean;
  published_at: string | null;
  unpublished_at: string | null;
  ml_item_id: string | null;
  video_url: string | null;
  floor_plan_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBPropertyPhoto {
  id: string;
  property_id: string;
  url: string;
  storage_path: string | null;
  order_index: number;
  is_cover: boolean;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  mime: string | null;
  created_at: string;
}

export interface PropertyWithPhotos extends DBProperty {
  photos: DBPropertyPhoto[];
}

export const STATUS_LABELS: Record<PropertyStatus, string> = {
  borrador: 'Borrador',
  disponible: 'Disponible',
  reservada: 'Reservada',
  vendida: 'Vendida',
  alquilada: 'Alquilada',
  caida: 'Caída',
  pausada: 'Pausada',
};

export const STATUS_COLORS: Record<PropertyStatus, string> = {
  borrador: 'bg-gray-100 text-gray-700',
  disponible: 'bg-green-100 text-green-700',
  reservada: 'bg-yellow-100 text-yellow-700',
  vendida: 'bg-red-100 text-red-700',
  alquilada: 'bg-red-100 text-red-700',
  caida: 'bg-orange-100 text-orange-700',
  pausada: 'bg-blue-100 text-blue-700',
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  departamento: 'Departamento',
  casa: 'Casa',
  ph: 'PH',
  local: 'Local',
  cochera: 'Cochera',
  terreno: 'Terreno',
  quinta: 'Quinta',
  oficina: 'Oficina',
  galpon: 'Galpón',
};

export const OPERATION_LABELS: Record<OperationType, string> = {
  venta: 'Venta',
  alquiler: 'Alquiler',
  temporario: 'Temporario',
};

export const CONDITION_LABELS: Record<PropertyCondition, string> = {
  nuevo: 'A estrenar',
  usado: 'Usado',
  a_reciclar: 'A reciclar',
  reciclado: 'Reciclado',
  en_construccion: 'En construcción',
  a_estrenar: 'A estrenar',
};

export const AMENITIES_OPTIONS = [
  { key: 'pool', label: 'Pileta', icon: '🏊' },
  { key: 'gym', label: 'Gimnasio', icon: '🏋' },
  { key: 'sum', label: 'SUM', icon: '🎉' },
  { key: 'security_24h', label: 'Seguridad 24hs', icon: '🛡' },
  { key: 'parking', label: 'Cochera', icon: '🚗' },
  { key: 'laundry', label: 'Lavadero', icon: '🧺' },
  { key: 'balcony', label: 'Balcón', icon: '🌅' },
  { key: 'terrace', label: 'Terraza', icon: '🪴' },
  { key: 'garden', label: 'Jardín', icon: '🌳' },
  { key: 'bbq', label: 'Parrilla', icon: '🔥' },
  { key: 'elevator', label: 'Ascensor', icon: '⬆' },
  { key: 'a_estrenar', label: 'A estrenar', icon: '✨' },
  { key: 'apto_credito', label: 'Apto crédito', icon: '💳' },
  { key: 'apto_mascotas', label: 'Apto mascotas', icon: '🐶' },
  { key: 'cochera_cubierta', label: 'Cochera cubierta', icon: '🅿' },
  { key: 'baulera', label: 'Baulera', icon: '📦' },
  { key: 'amoblado', label: 'Amoblado', icon: '🛋' },
  { key: 'aire_acondicionado', label: 'Aire acondicionado', icon: '❄' },
  { key: 'calefaccion', label: 'Calefacción', icon: '🔥' },
];

// ── Service ──────────────────────────────────────────────────────────────────

export const properties = {
  async list(): Promise<PropertyWithPhotos[]> {
    const { data: props, error } = await supabase
      .from('properties')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const list = (props ?? []) as DBProperty[];
    if (list.length === 0) return [];

    const ids = list.map(p => p.id);
    const { data: photos } = await supabase
      .from('property_photos')
      .select('*')
      .in('property_id', ids)
      .order('order_index', { ascending: true });
    const photosByProp = new Map<string, DBPropertyPhoto[]>();
    for (const ph of (photos ?? []) as DBPropertyPhoto[]) {
      const arr = photosByProp.get(ph.property_id) ?? [];
      arr.push(ph);
      photosByProp.set(ph.property_id, arr);
    }
    return list.map(p => ({ ...p, photos: photosByProp.get(p.id) ?? [], amenities: p.amenities ?? [] }));
  },

  async get(id: string): Promise<PropertyWithPhotos | null> {
    const { data: prop, error } = await supabase
      .from('properties')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!prop) return null;
    const { data: photos } = await supabase
      .from('property_photos')
      .select('*')
      .eq('property_id', id)
      .order('order_index', { ascending: true });
    return { ...(prop as DBProperty), photos: (photos ?? []) as DBPropertyPhoto[], amenities: (prop as DBProperty).amenities ?? [] };
  },

  async create(input: Partial<DBProperty>): Promise<DBProperty> {
    const { data, error } = await supabase
      .from('properties')
      .insert(input)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id: string, patch: Partial<DBProperty>): Promise<DBProperty> {
    const { data, error } = await supabase
      .from('properties')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async setStatus(id: string, status: PropertyStatus): Promise<void> {
    const { error } = await supabase.from('properties').update({ status }).eq('id', id);
    if (error) throw error;
  },

  async publish(id: string): Promise<{ ok: boolean; errors?: string[]; public_url?: string; sync?: Record<string, string> }> {
    const { data, error } = await supabase.functions.invoke('publish-property', {
      body: { property_id: id, publish: true },
    });
    if (error) {
      // Si la function todavía no está deployada, fallback al update directo
      const { error: upErr } = await supabase
        .from('properties')
        .update({ is_published: true, status: 'disponible' })
        .eq('id', id);
      if (upErr) throw upErr;
      return { ok: true };
    }
    if (data?.errors) return { ok: false, errors: data.errors };
    return { ok: true, public_url: data?.property?.public_url, sync: data?.sync };
  },

  async unpublish(id: string): Promise<void> {
    const { error } = await supabase.functions.invoke('publish-property', {
      body: { property_id: id, publish: false },
    });
    if (error) {
      const { error: upErr } = await supabase.from('properties').update({ is_published: false }).eq('id', id);
      if (upErr) throw upErr;
    }
  },

  async remove(id: string): Promise<void> {
    // Borrar fotos del storage primero
    const { data: photos } = await supabase
      .from('property_photos')
      .select('storage_path')
      .eq('property_id', id);
    const paths = (photos ?? []).map(p => p.storage_path).filter((x): x is string => !!x);
    if (paths.length) {
      await supabase.storage.from('property-photos').remove(paths);
    }
    const { error } = await supabase.from('properties').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Photos ────────────────────────────────────────────────────────────────

  async uploadPhoto(propertyId: string, file: File, orderIndex: number, isCover = false): Promise<DBPropertyPhoto> {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const safeName = `${Date.now()}_${orderIndex}.${ext}`;
    const path = `${propertyId}/${safeName}`;
    const { error: upErr } = await supabase.storage
      .from('property-photos')
      .upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from('property-photos').getPublicUrl(path);

    const { data, error } = await supabase
      .from('property_photos')
      .insert({
        property_id: propertyId,
        url: pub.publicUrl,
        storage_path: path,
        order_index: orderIndex,
        is_cover: isCover,
        mime: file.type,
        size_bytes: file.size,
      })
      .select()
      .single();
    if (error) throw error;

    // Si es portada, sincronizamos en properties.cover_photo_url
    if (isCover) {
      await supabase.from('properties').update({ cover_photo_url: pub.publicUrl }).eq('id', propertyId);
    }
    return data;
  },

  async setCoverPhoto(propertyId: string, photoId: string): Promise<void> {
    // Limpio otros covers
    await supabase.from('property_photos').update({ is_cover: false }).eq('property_id', propertyId);
    // Marco el nuevo
    const { data: photo, error } = await supabase
      .from('property_photos')
      .update({ is_cover: true })
      .eq('id', photoId)
      .select()
      .single();
    if (error) throw error;
    await supabase.from('properties').update({ cover_photo_url: photo.url }).eq('id', propertyId);
  },

  async reorderPhotos(propertyId: string, orderedIds: string[]): Promise<void> {
    // Hago un update por foto. Postgres no tiene update con VALUES por id sin extensión.
    const updates = orderedIds.map((id, idx) =>
      supabase.from('property_photos').update({ order_index: idx }).eq('id', id).eq('property_id', propertyId),
    );
    await Promise.all(updates);
  },

  async getStatusHistory(propertyId: string): Promise<Array<{ old_status: string | null; new_status: string; changed_at: string; reason: string | null }>> {
    const { data } = await supabase
      .from('property_status_history')
      .select('old_status,new_status,changed_at,reason')
      .eq('property_id', propertyId)
      .order('changed_at', { ascending: false });
    return data ?? [];
  },

  async getPriceHistory(propertyId: string): Promise<Array<{ old_price: number | null; new_price: number; currency: string; changed_at: string; reason: string | null }>> {
    const { data } = await supabase
      .from('property_price_history')
      .select('old_price,new_price,currency,changed_at,reason')
      .eq('property_id', propertyId)
      .order('changed_at', { ascending: false });
    return data ?? [];
  },

  async removePhoto(photoId: string): Promise<void> {
    const { data: photo } = await supabase.from('property_photos').select('*').eq('id', photoId).maybeSingle();
    if (photo?.storage_path) {
      await supabase.storage.from('property-photos').remove([photo.storage_path]);
    }
    await supabase.from('property_photos').delete().eq('id', photoId);
  },
};
