// Integración Mercado Libre — publicar / actualizar / despublicar propiedades.
//
// CONFIGURACIÓN NECESARIA EN SUPABASE SECRETS:
//   ML_CLIENT_ID       - App ID de developers.mercadolibre.com
//   ML_CLIENT_SECRET   - Secret de la app
//   ML_REFRESH_TOKEN   - Refresh token obtenido del OAuth flow inicial (no vence)
//   ML_USER_ID         - User ID del seller (queda en el JWT del primer OAuth)
//
// OAUTH FLOW INICIAL (one-shot, hace falta hacerlo 1 vez por el dueño):
//   1. Registrar app en developers.mercadolibre.com con redirect_uri =
//      https://crm-turdo.vercel.app/oauth/ml-callback
//   2. Dirigir a https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=$CLIENT_ID&redirect_uri=$REDIRECT
//   3. Después del consent, ML redirige con ?code=XXX. Intercambiar por tokens:
//      POST https://api.mercadolibre.com/oauth/token
//        grant_type=authorization_code & client_id=... & client_secret=... &
//        code=... & redirect_uri=...
//   4. Guardar refresh_token en ML_REFRESH_TOKEN y user_id en ML_USER_ID
//
// El access_token se renueva automáticamente con cada llamada.

const ML_API = 'https://api.mercadolibre.com';

interface MLTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  scope: string;
}

interface MLItemPayload {
  title: string;
  category_id: string;
  price: number;
  currency_id: 'ARS' | 'USD';
  available_quantity: number;
  condition: 'new' | 'used' | 'not_specified';
  listing_type_id: 'free' | 'bronze' | 'silver' | 'gold' | 'gold_premium' | 'gold_special' | 'gold_pro';
  pictures: Array<{ source: string }>;
  description?: { plain_text: string };
  attributes?: Array<{ id: string; value_id?: string; value_name?: string; value_struct?: { number: number; unit: string } }>;
  location?: {
    address_line?: string;
    city?: { name: string };
    state?: { name: string };
    country?: { name: string };
    latitude?: number;
    longitude?: number;
  };
}

interface MLItemResponse {
  id: string;
  permalink: string;
  status: string;
  errors?: Array<{ code: string; message: string }>;
}

export interface PropertyForML {
  id: string;
  internal_code: string | null;
  address: string | null;
  street: string | null;
  street_number: string | null;
  barrio: string | null;
  city: string;
  province: string;
  description: string | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garage: number | null;
  surface_m2: number | null;
  surface_total_m2: number | null;
  list_price_usd: number | null;
  price_currency: 'USD' | 'ARS';
  operation_type: string; // 'venta' | 'alquiler'
  property_type: string; // 'departamento' | 'casa' | 'ph' | etc
  condition: string;     // 'usado' | 'a_estrenar' | etc
  latitude: number | null;
  longitude: number | null;
  ml_item_id: string | null;
}

// ── OAuth: refrescar access token usando refresh_token ─────────────────────

let _cachedToken: { value: string; exp: number } | null = null;

export async function getMLAccessToken(): Promise<string> {
  // Cache en memoria 5h (los access tokens duran 6h)
  if (_cachedToken && Date.now() < _cachedToken.exp - 60_000) return _cachedToken.value;

  const clientId = Deno.env.get('ML_CLIENT_ID');
  const clientSecret = Deno.env.get('ML_CLIENT_SECRET');
  const refreshToken = Deno.env.get('ML_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('ML_CLIENT_ID / ML_CLIENT_SECRET / ML_REFRESH_TOKEN no configurados en Supabase secrets');
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const r = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: form.toString(),
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`ML OAuth refresh failed: ${r.status} ${errText.slice(0, 200)}`);
  }

  const json = await r.json() as MLTokenResponse;
  _cachedToken = { value: json.access_token, exp: Date.now() + (json.expires_in * 1000) };

  // ML rota el refresh_token cada vez. Para que la próxima llamada use el nuevo,
  // el dueño debería actualizar ML_REFRESH_TOKEN en Supabase. Lo loguamos para
  // que se vea fácil en function logs. (TODO: si llegamos a falla por token
  // rotado, automatizar update via Management API.)
  console.log('[ML] new refresh_token (guardar en Supabase secrets si rotó):', json.refresh_token.slice(0, 20) + '...');

  return json.access_token;
}

// ── Mapeo de categorías ML por tipo de propiedad + operación ────────────────
//
// Ver listado completo:
//   https://api.mercadolibre.com/sites/MLA/categories/MLA1459/children (recursivo)
// IDs típicos para Argentina (MLA):

const ML_CATEGORY_MAP: Record<string, Record<string, string>> = {
  venta: {
    departamento: 'MLA1466',
    casa: 'MLA1472',
    ph: 'MLA1468',
    terreno: 'MLA1471',
    galpon: 'MLA401686',
    local: 'MLA1473',
    oficina: 'MLA1474',
  },
  alquiler: {
    departamento: 'MLA1467',
    casa: 'MLA105165',
    ph: 'MLA1469',
    terreno: 'MLA1471',
    local: 'MLA1473',
    oficina: 'MLA1474',
  },
};

function mlCategoryFor(operation: string, type: string): string {
  return ML_CATEGORY_MAP[operation]?.[type] ?? 'MLA1466'; // default: depto en venta
}

// ── Convertir propiedad CRM → payload ML ────────────────────────────────────

export function propertyToMLItem(prop: PropertyForML, pictures: string[]): MLItemPayload {
  const opType = prop.operation_type ?? 'venta';
  const propType = prop.property_type ?? 'departamento';

  const title = [
    propType.charAt(0).toUpperCase() + propType.slice(1),
    prop.bedrooms ? `${prop.bedrooms} dorm.` : prop.rooms ? `${prop.rooms} amb.` : null,
    prop.barrio,
  ].filter(Boolean).join(' · ').slice(0, 60);

  // ML condition map
  const conditionMap: Record<string, MLItemPayload['condition']> = {
    a_estrenar: 'new',
    nuevo: 'new',
    usado: 'used',
    reciclado: 'used',
  };
  const condition = conditionMap[prop.condition] ?? 'not_specified';

  // Attributes — basics que ML requiere para inmuebles en MLA
  const attributes: MLItemPayload['attributes'] = [
    { id: 'OPERATION', value_name: opType === 'venta' ? 'Venta' : 'Alquiler' },
    { id: 'PROPERTY_TYPE', value_name: propType.charAt(0).toUpperCase() + propType.slice(1) },
  ];
  if (prop.rooms) attributes.push({ id: 'ROOMS', value_name: String(prop.rooms) });
  if (prop.bedrooms) attributes.push({ id: 'BEDROOMS', value_name: String(prop.bedrooms) });
  if (prop.bathrooms) attributes.push({ id: 'FULL_BATHROOMS', value_name: String(prop.bathrooms) });
  if (prop.garage) attributes.push({ id: 'PARKING_LOTS', value_name: String(prop.garage) });
  if (prop.surface_m2) attributes.push({ id: 'COVERED_AREA', value_struct: { number: prop.surface_m2, unit: 'm²' } });
  if (prop.surface_total_m2) attributes.push({ id: 'TOTAL_AREA', value_struct: { number: prop.surface_total_m2, unit: 'm²' } });

  return {
    title,
    category_id: mlCategoryFor(opType, propType),
    price: Number(prop.list_price_usd),
    currency_id: prop.price_currency,
    available_quantity: 1,
    condition,
    listing_type_id: 'silver',     // tier estándar — Leti puede ajustar a 'gold' / 'gold_pro' si quiere más visibilidad pagando más
    pictures: pictures.slice(0, 12).map(url => ({ source: url })),
    description: prop.description ? { plain_text: prop.description } : undefined,
    attributes,
    location: {
      address_line: prop.address ?? [prop.street, prop.street_number].filter(Boolean).join(' '),
      city: { name: prop.city },
      state: { name: prop.province },
      country: { name: 'Argentina' },
      ...(prop.latitude && prop.longitude ? { latitude: prop.latitude, longitude: prop.longitude } : {}),
    },
  };
}

// ── Crear item nuevo en ML ──────────────────────────────────────────────────

export async function publishToML(prop: PropertyForML, pictures: string[]): Promise<{ ok: true; item_id: string; permalink: string } | { ok: false; error: string }> {
  try {
    const token = await getMLAccessToken();
    const payload = propertyToMLItem(prop, pictures);

    const r = await fetch(`${ML_API}/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await r.json() as MLItemResponse;
    if (!r.ok || json.errors) {
      const errMsg = json.errors?.map(e => `${e.code}: ${e.message}`).join('; ') ?? `HTTP ${r.status}`;
      return { ok: false, error: errMsg };
    }
    return { ok: true, item_id: json.id, permalink: json.permalink };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Actualizar item existente ───────────────────────────────────────────────

export async function updateMLItem(itemId: string, prop: PropertyForML, pictures: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getMLAccessToken();
    const payload = propertyToMLItem(prop, pictures);

    const r = await fetch(`${ML_API}/items/${itemId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const errText = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${errText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Despublicar / pausar / cerrar item ──────────────────────────────────────

export async function unpublishMLItem(itemId: string, mode: 'paused' | 'closed' = 'paused'): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getMLAccessToken();
    const r = await fetch(`${ML_API}/items/${itemId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: mode }),
    });
    if (!r.ok) {
      const errText = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${errText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
