// Infiere las preferencias de búsqueda de un lead leyendo sus mensajes + notes + custom fields ManyChat.
// Llama Claude Haiku para extraer estructura: zonas, presupuesto, ambientes, etc.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAuth } from '../_shared/auth.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// CORS lockdown: solo dominios permitidos pueden invocar esta edge function.
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

const SYSTEM_PROMPT = `Sos un extractor de preferencias de búsqueda de clientes inmobiliarios en Mar del Plata, Argentina.

Tu trabajo: leer la conversación del lead con el vendedor (+ las notas del CRM) y devolver un JSON estructurado con lo que el cliente está buscando.

REGLAS:
- Solo extraés lo que está EXPLÍCITO o CASI EXPLÍCITO. No inventes.
- Si un campo no aparece, devolvelo como null.
- Las zonas son barrios de Mar del Plata. Normalizá: "Plaza España" / "plaza españa" / "España" → "Plaza España". Otros barrios típicos: Plaza Mitre, Centro, Macrocentro, Los Troncos, La Perla, Constitución, Punta Mogotes, Stella Maris, Alem, Norte.
- Presupuesto en USD. Si dice "85" sin unidad, interpretá como USD 85.000. Si dice "85k" o "85 mil" igual.
- property_type: depto / casa / ph / cochera / local / terreno
- purpose: vivir / invertir / ambos
- timing: ya / 1_3m / 3_6m / explorando

OUTPUT estricto en JSON, sin markdown, sin texto adicional:
{
  "zonas": ["Plaza Mitre", "Centro"] | [],
  "rooms_min": 1 | null,
  "rooms_max": 3 | null,
  "surface_min": 50 | null,
  "surface_max": null,
  "budget_min_usd": 80000 | null,
  "budget_max_usd": 130000 | null,
  "property_type": "depto" | null,
  "purpose": "vivir" | null,
  "timing": "1_3m" | null,
  "notes_extra": "preferencia opcional, cosa importante" | null,
  "confidence": 0.0-1.0,
  "reason": "explicación corta"
}

Si la conversación es claramente spam comercial, no es un lead real, o no tiene NADA de info de búsqueda, devolvé confidence: 0 y todos los campos en null/[].`;

interface MessageRow { content: string; direction: 'in' | 'out' }

Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (!CORS) return new Response('Forbidden origin', { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  // Auth check: bloquear invocaciones anonimas (Claude API caro / abuso)
  const authError = await requireAuth(req, CORS);
  if (authError) return authError;

  let body: { contact_id?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { contact_id } = body;
  if (!contact_id) return new Response(JSON.stringify({ error: 'contact_id required' }), { status: 400, headers: CORS });

  const [{ data: contact }, { data: messages }] = await Promise.all([
    sb.from('contacts').select('id, name, channel, property_title, notes, current_stage_key').eq('id', contact_id).single(),
    sb.from('messages').select('content, direction').eq('contact_id', contact_id).order('created_at', { ascending: true }).limit(40),
  ]);

  if (!contact) return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404, headers: CORS });

  const conv = ((messages ?? []) as MessageRow[]).slice(-20)
    .map(m => `${m.direction === 'in' ? 'CLIENTE' : 'VENDEDOR'}: ${m.content.slice(0, 350)}`)
    .join('\n');

  if (!conv && !contact.notes && !contact.property_title) {
    return new Response(JSON.stringify({ skipped: true, reason: 'no_data_to_infer' }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const userPrompt = `LEAD: ${contact.name ?? 'Sin nombre'} (${contact.channel})${contact.property_title ? `\nPROPIEDAD CONSULTADA: ${contact.property_title}` : ''}${contact.notes ? `\nNOTAS DEL VENDEDOR: ${contact.notes}` : ''}

CONVERSACIÓN:
${conv || '(sin mensajes)'}

Extraé las preferencias en JSON.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    return new Response(JSON.stringify({ error: 'AI service error' }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const data = await resp.json();
  const text: string = data?.content?.[0]?.text ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return new Response(JSON.stringify({ error: 'No JSON in response' }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let prefs: Record<string, unknown>;
  try { prefs = JSON.parse(m[0]); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON from AI' }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  // Si confidence muy baja, no guardar (lead spam o sin info)
  const confidence = (prefs.confidence as number) ?? 0;
  if (confidence < 0.3) {
    return new Response(JSON.stringify({ skipped: true, reason: 'low_confidence', confidence }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Upsert preferences
  await sb.from('lead_preferences').upsert({
    contact_id,
    zonas: (prefs.zonas as string[]) ?? [],
    rooms_min: prefs.rooms_min ?? null,
    rooms_max: prefs.rooms_max ?? null,
    surface_min: prefs.surface_min ?? null,
    surface_max: prefs.surface_max ?? null,
    budget_min_usd: prefs.budget_min_usd ?? null,
    budget_max_usd: prefs.budget_max_usd ?? null,
    property_type: prefs.property_type ?? null,
    purpose: prefs.purpose ?? null,
    timing: prefs.timing ?? null,
    notes_extra: prefs.notes_extra ?? null,
    source: 'inferred',
    inferred_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'contact_id' });

  return new Response(JSON.stringify({
    contact_id,
    confidence,
    reason: prefs.reason,
    preferences: prefs,
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
