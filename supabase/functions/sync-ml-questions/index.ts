// Edge function: sync-ml-questions
// Trae preguntas nuevas de ML y las inserta como contactos en el CRM.
//
// Estrategia:
//   1. Lee access_token de ml_oauth. Si está vencido, intenta refresh.
//   2. Si no hay refresh_token o refresh falla → marca needs_reauth y exit OK
//      (no crashea el cron, pero loguea que hace falta re-autorizar).
//   3. Llama GET /questions/search?seller_id=X&limit=50 (devuelve preguntas
//      ordenadas por fecha desc).
//   4. Filtra las que tengan date_created > ml_sync_state.last_synced_at.
//   5. Para cada pregunta nueva:
//      a) Lookup nombre real del usuario via /users/{from.id}
//      b) Lookup título de la publicación via /items/{item_id}
//      c) Detecta teléfono en el texto via regex
//      d) Inserta contacto en CRM con channel='whatsapp' (si hay phone) o 'web'
//      e) Inserta mensaje sintético con texto de la pregunta
//   6. Actualiza ml_sync_state.last_synced_at.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

interface MLOauth {
  access_token: string;
  refresh_token: string | null;
  user_id: number;
  expires_at: string;
}

// Refresca el access_token usando el refresh_token. Devuelve el nuevo token
// o null si falla (típicamente porque la app no tiene Refresh Token habilitado).
async function refreshToken(oauth: MLOauth): Promise<string | null> {
  if (!oauth.refresh_token) return null;
  try {
    const r = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ML_CLIENT_ID,
        client_secret: ML_CLIENT_SECRET,
        refresh_token: oauth.refresh_token,
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.access_token) {
      console.warn('[ml-sync] refresh failed:', JSON.stringify(data));
      return null;
    }
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 21600) * 1000).toISOString();
    await sb.from('ml_oauth').update({
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? oauth.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    return data.access_token;
  } catch (e) {
    console.warn('[ml-sync] refresh error:', e);
    return null;
  }
}

async function getValidAccessToken(): Promise<{ token: string; userId: number } | { error: string }> {
  const { data: oauth } = await sb.from('ml_oauth').select('*').eq('id', 1).maybeSingle();
  if (!oauth) return { error: 'No hay token de ML guardado. Hace falta autorizar la app primero.' };
  const now = Date.now();
  const expires = new Date(oauth.expires_at).getTime();
  // Si vence en menos de 10 min, refrescar proactivamente
  if (expires - now < 600_000) {
    const newToken = await refreshToken(oauth as MLOauth);
    if (newToken) return { token: newToken, userId: oauth.user_id };
    if (expires < now) {
      return { error: 'Token de ML vencido y no se pudo refrescar (probable: falta habilitar Refresh Token en la app y re-autorizar).' };
    }
  }
  return { token: oauth.access_token, userId: oauth.user_id };
}

interface MLQuestion {
  id: number;
  date_created: string;
  text: string;
  item_id: string;
  status: string;
  from: { id: number };
}

async function fetchQuestions(token: string, sellerId: number, since: string | null): Promise<MLQuestion[]> {
  const params = new URLSearchParams({
    seller_id: String(sellerId),
    limit: '50',
    sort_fields: 'date_created',
    sort_types: 'DESC',
    access_token: token,
  });
  const r = await fetch(`https://api.mercadolibre.com/questions/search?${params}`);
  if (!r.ok) return [];
  const j = await r.json();
  let questions = (j.questions ?? []) as MLQuestion[];
  if (since) {
    const sinceMs = new Date(since).getTime();
    questions = questions.filter(q => new Date(q.date_created).getTime() > sinceMs);
  }
  return questions;
}

// Cache simple para no llamar muchas veces al mismo endpoint
const userNameCache = new Map<number, string>();
const itemTitleCache = new Map<string, string>();

async function getUserName(userId: number, token: string): Promise<string> {
  if (userNameCache.has(userId)) return userNameCache.get(userId)!;
  try {
    const r = await fetch(`https://api.mercadolibre.com/users/${userId}?access_token=${token}`);
    if (!r.ok) return 'Usuario ML';
    const d = await r.json();
    const name = [d.first_name, d.last_name].filter(Boolean).join(' ').trim() || d.nickname || 'Usuario ML';
    userNameCache.set(userId, name);
    return name;
  } catch { return 'Usuario ML'; }
}

async function getItemTitle(itemId: string, token: string): Promise<string> {
  if (itemTitleCache.has(itemId)) return itemTitleCache.get(itemId)!;
  try {
    const r = await fetch(`https://api.mercadolibre.com/items/${itemId}?access_token=${token}`);
    if (!r.ok) return itemId;
    const d = await r.json();
    const title = (d.title as string) ?? itemId;
    itemTitleCache.set(itemId, title);
    return title;
  } catch { return itemId; }
}

// Detecta teléfono argentino en el texto de la pregunta. Patrones comunes:
//   +54 9 223 555-1234, 223 555 1234, 11 6555 1234, 02234567890, etc.
function extractPhone(text: string): string | null {
  // Saca todo lo no-dígito + plus para análisis
  const candidates = text.match(/(\+?\d[\d\s\-().]{7,})/g) ?? [];
  for (const raw of candidates) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) {
      // Probable teléfono
      return digits.length >= 12 ? `+${digits}` : `+54${digits}`;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  // Permitir solo POST con secret matching service_role (cron) o GET para debug
  const authHeader = req.headers.get('Authorization') ?? '';
  const isService = authHeader.includes(SERVICE_KEY);
  const isCron = req.method === 'POST' && (req.headers.get('x-cron-trigger') || isService);

  const tokenInfo = await getValidAccessToken();
  if ('error' in tokenInfo) {
    return new Response(JSON.stringify({ ok: false, error: tokenInfo.error }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { token, userId } = tokenInfo;

  // Estado: cuándo fue el último sync
  const { data: state } = await sb.from('ml_sync_state').select('*').eq('id', 1).maybeSingle();
  const since = state?.last_synced_at ?? new Date(Date.now() - 7 * 86400_000).toISOString();

  const questions = await fetchQuestions(token, userId, since);
  let inserted = 0;
  let skipped = 0;
  let errored = 0;
  const samples: Array<{ qid: number; name: string; item: string; phone: string | null }> = [];

  for (const q of questions) {
    try {
      // Dedup: si ya existe contacto con channel_id = ml_q_<qid>, skip
      const channelId = `ml_q_${q.id}`;
      const { data: existing } = await sb.from('contacts')
        .select('id').eq('channel_id', channelId).maybeSingle();
      if (existing) { skipped++; continue; }

      const [userName, itemTitle] = await Promise.all([
        getUserName(q.from.id, token),
        getItemTitle(q.item_id, token),
      ]);
      const phone = extractPhone(q.text);

      // Notes block
      const notes = [
        `📥 Pregunta ML en publicación: ${itemTitle}`,
        `Item ID: ${q.item_id}`,
        `Pregunta ML #${q.id}`,
        `Fecha: ${q.date_created}`,
        `Status: ${q.status}`,
        '',
        `Texto: "${q.text}"`,
      ].join('\n');

      const { data: contact, error: insertErr } = await sb.from('contacts').insert({
        name: userName,
        phone: phone,
        email: null,
        channel: phone ? 'whatsapp' : 'web',
        channel_id: channelId,
        status: 'new',
        current_stage_key: 'nuevo',
        property_title: itemTitle,
        notes,
        branch: 'Sucursal Centro',
      }).select('id').single();

      if (insertErr) {
        if (insertErr.code === '23505') { skipped++; continue; }
        console.error('[ml-questions] insert err:', insertErr);
        errored++;
        continue;
      }

      // Mensaje sintético entrante con el texto de la pregunta
      if (contact) {
        await sb.from('messages').insert({
          contact_id: contact.id,
          direction: 'in',
          content: q.text,
          channel: phone ? 'whatsapp' : 'web',
          read: false,
          created_at: q.date_created,
        });
      }

      inserted++;
      if (samples.length < 10) {
        samples.push({ qid: q.id, name: userName, item: itemTitle.slice(0, 50), phone });
      }
    } catch (e) {
      console.error('[ml-questions] error:', e);
      errored++;
    }
  }

  // Actualizar estado
  if (questions.length > 0) {
    const newest = questions.reduce((a, b) =>
      new Date(a.date_created).getTime() > new Date(b.date_created).getTime() ? a : b
    );
    await sb.from('ml_sync_state').upsert({
      id: 1,
      last_synced_at: newest.date_created,
      last_lead_id: String(newest.id),
      total_synced: (state?.total_synced ?? 0) + inserted,
      last_error: null,
      updated_at: new Date().toISOString(),
    });
  } else {
    await sb.from('ml_sync_state').upsert({
      id: 1,
      last_synced_at: state?.last_synced_at ?? new Date().toISOString(),
      total_synced: state?.total_synced ?? 0,
      last_error: null,
      updated_at: new Date().toISOString(),
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    found_questions: questions.length,
    inserted,
    skipped,
    errored,
    samples,
    since,
    user_id: userId,
    is_cron: !!isCron,
  }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
