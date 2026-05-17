// Edge function: sugiere 3 respuestas posibles al vendedor según el contexto del lead.
// Lee últimos 8 mensajes + ficha del contact + propiedad asociada (si hay) y llama Claude Haiku
// para generar variantes con tonos distintos: cálido, directo, persuasivo.

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

const SYSTEM_PROMPT = `Sos un asistente de respuestas para vendedores inmobiliarios de Turdo (Mar del Plata, Argentina).

Tu trabajo: leer la conversación entre vendedor y cliente, y generar 3 respuestas posibles para enviarle al cliente AHORA.

REGLAS DE TONO Y ESTILO:
- Español argentino (vos / che / dale, no "tú"). Profesional pero cálido.
- NO usar formalismos tipo "estimado", "cordialmente". Sí "hola", "che", "dale", "barbaro".
- Frases cortas y claras. Máximo 2-3 oraciones por respuesta.
- NUNCA prometer "sin comisión" para nadie (regla del negocio).
- NO inventar datos: si no sabés precio/dirección/m², no los pongas. Pedir info al cliente o decir que confirmás.
- Si el cliente pregunta algo concreto que el contexto NO te da, una buena respuesta es ofrecer mandarle la info en breve.
- Pensá en la próxima acción que mueve la venta: visita, llamado, mandar fotos, mandar plano, conocer presupuesto.

LAS 3 RESPUESTAS DEBEN TENER VARIANTES DE TONO:
1. **Cálido / humano**: empatía, conexión personal, sin presión
2. **Directo / accionable**: propone próximo paso concreto (visita, llamado, día/hora)
3. **Persuasivo / con valor**: agrega un dato, urgencia o diferencial (ej: poca disponibilidad, oportunidad)

OUTPUT: JSON estricto, sin markdown ni texto adicional.
{
  "suggestions": [
    {"tone": "cálido", "text": "..."},
    {"tone": "directo", "text": "..."},
    {"tone": "persuasivo", "text": "..."}
  ]
}`;

interface ContactRow {
  id: string;
  name: string | null;
  phone: string | null;
  channel: string;
  property_title: string | null;
  property_id: string | null;
  notes: string | null;
  current_stage_key: string | null;
}

interface MessageRow {
  content: string;
  direction: 'in' | 'out';
  created_at: string;
}

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCors(req);
  if (!CORS_HEADERS) return new Response('Forbidden origin', { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });

  // Auth check: bloquear invocaciones anonimas (Claude API caro / abuso)
  const authError = await requireAuth(req, CORS_HEADERS);
  if (authError) return authError;

  let body: { contact_id?: string; agent_name?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS_HEADERS }); }

  const { contact_id, agent_name } = body;
  if (!contact_id) return new Response(JSON.stringify({ error: 'contact_id required' }), { status: 400, headers: CORS_HEADERS });

  const [{ data: contact }, { data: messages }] = await Promise.all([
    sb.from('contacts').select('id, name, phone, channel, property_title, property_id, notes, current_stage_key').eq('id', contact_id).single(),
    sb.from('messages').select('content, direction, created_at').eq('contact_id', contact_id).order('created_at', { ascending: true }).limit(20),
  ]);

  if (!contact) return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404, headers: CORS_HEADERS });

  const c = contact as ContactRow;
  const recent = ((messages ?? []) as MessageRow[]).slice(-8);

  // Property context (opcional, si el lead tiene propiedad asociada)
  let propertyContext = '';
  if (c.property_id) {
    const { data: prop } = await sb
      .from('properties')
      .select('tokko_sku, address, barrio, list_price_usd, rooms, surface_m2, status')
      .eq('id', c.property_id)
      .maybeSingle();
    if (prop) {
      propertyContext = `\nPROPIEDAD CONSULTADA: ${prop.tokko_sku ?? 'sin código'} · ${prop.address ?? '?'} · ${prop.barrio ?? ''} · USD ${prop.list_price_usd ?? '?'} · ${prop.rooms ?? '?'} amb · ${prop.surface_m2 ?? '?'} m² · estado ${prop.status ?? '?'}`.trim();
    }
  } else if (c.property_title) {
    propertyContext = `\nPROPIEDAD CONSULTADA (texto libre): ${c.property_title}`;
  }

  const conversation = recent
    .map(m => `${m.direction === 'in' ? 'CLIENTE' : 'VENDEDOR'}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const userPrompt = `LEAD: ${c.name ?? 'Sin nombre'} (${c.channel})
ETAPA ACTUAL: ${c.current_stage_key ?? 'nuevo'}${c.notes ? `\nNOTAS DEL VENDEDOR: ${c.notes}` : ''}${propertyContext}
${agent_name ? `\nVENDEDOR QUE VA A RESPONDER: ${agent_name}` : ''}

CONVERSACIÓN (orden cronológico, último abajo):
${conversation || '(sin mensajes previos)'}

Generá las 3 sugerencias de respuesta. Devolvé solo el JSON.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Anthropic error', resp.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error', detail: errText.slice(0, 200) }), {
        status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const text: string = data?.content?.[0]?.text ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) {
      return new Response(JSON.stringify({ error: 'No JSON in response', raw: text.slice(0, 300) }), {
        status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const parsed = JSON.parse(m[0]) as { suggestions?: Array<{ tone: string; text: string }> };
    return new Response(JSON.stringify({
      suggestions: parsed.suggestions ?? [],
    }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Unexpected', detail: String(e) }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
