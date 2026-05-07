// Califica un lead inmobiliario: lee mensajes + datos del contacto y devuelve hot/warm/cold + score.
// Llamado fire-and-forget desde classify-message-stage cuando un lead llega a en_conversacion
// y todavía no tiene calificación, o cuando se acumulan 5+ mensajes nuevos.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `Sos un calificador de leads inmobiliarios de Turdo (Mar del Plata, Argentina).

Tu trabajo: leer la conversación entre vendedor y cliente y calificar al lead.

ETIQUETAS:
- "hot" 🔥 → cliente con presupuesto claro, timing inmediato (<3 meses), pregunta concreta, decidido. Score 70-100.
- "warm" 🌤️ → interés real pero indefinido (timing, presupuesto o intención poco claros). Está explorando seriamente. Score 35-69.
- "cold" ❄️ → consulta general sin urgencia, sin presupuesto, "estoy mirando", o spam comercial / curioso. Score 0-34.

CRITERIOS QUE SUMAN PUNTOS:
+ Menciona presupuesto concreto (USD)
+ Pide visita o ya quiere ver la propiedad
+ Timing claro ("este mes", "ya tengo el dinero", "vence el alquiler en X")
+ Pregunta específica sobre LA propiedad (no genérica)
+ Es una segunda interacción tras un buen primer contacto
+ Hay coincidencia entre lo que busca y lo que le ofrecen

CRITERIOS QUE RESTAN:
- "Estoy mirando"
- "Para más adelante"
- "No tengo apuro"
- Sin presupuesto, sin timing, sin objetivo claro
- Es un proveedor / spam comercial / vendedor que ofrece servicios → cold + score 0-10

OUTPUT: JSON estricto, sin markdown.
{ "label": "hot" | "warm" | "cold", "score": 0-100, "reason": "explicación corta en español, max 150 chars" }`;

interface ContactRow {
  id: string;
  name: string | null;
  channel: string;
  property_title: string | null;
  notes: string | null;
  current_stage_key: string | null;
  created_at: string;
}

interface MessageRow {
  content: string;
  direction: 'in' | 'out';
}

interface QualifyResult {
  label: 'hot' | 'warm' | 'cold';
  score: number;
  reason: string;
}

async function callClaude(prompt: string): Promise<QualifyResult | null> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    console.error('Anthropic err', resp.status, await resp.text());
    return null;
  }

  const data = await resp.json();
  const text: string = data?.content?.[0]?.text ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]) as QualifyResult;
    if (!['hot','warm','cold'].includes(parsed.label)) return null;
    parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score ?? 0)));
    parsed.reason = String(parsed.reason ?? '').slice(0, 200);
    return parsed;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: { contact_id?: string; force?: boolean };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { contact_id, force = false } = body;
  if (!contact_id) return new Response(JSON.stringify({ error: 'contact_id required' }), { status: 400, headers: CORS });

  const [{ data: contact }, { data: messages }] = await Promise.all([
    sb.from('contacts').select('id, name, channel, property_title, notes, current_stage_key, created_at, quality_label, qualified_at').eq('id', contact_id).single(),
    sb.from('messages').select('content, direction').eq('contact_id', contact_id).order('created_at', { ascending: true }).limit(20),
  ]);

  if (!contact) return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404, headers: CORS });
  const c = contact as ContactRow & { quality_label?: string; qualified_at?: string };

  // Solo calificamos si hay al menos 2 mensajes IN del cliente, o si force=true
  const inMsgs = ((messages ?? []) as MessageRow[]).filter(m => m.direction === 'in');
  if (!force && inMsgs.length < 2) {
    return new Response(JSON.stringify({ skipped: true, reason: 'not_enough_messages', count: inMsgs.length }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const conv = ((messages ?? []) as MessageRow[]).slice(-12)
    .map(m => `${m.direction === 'in' ? 'CLIENTE' : 'VENDEDOR'}: ${m.content.slice(0, 300)}`)
    .join('\n');

  const userPrompt = `LEAD: ${c.name ?? 'Sin nombre'} (${c.channel})
ETAPA: ${c.current_stage_key ?? 'nuevo'}${c.property_title ? `\nPROPIEDAD CONSULTADA: ${c.property_title}` : ''}${c.notes ? `\nNOTAS: ${c.notes}` : ''}

CONVERSACIÓN:
${conv}

Calificá el lead. Devolvé el JSON pedido.`;

  const result = await callClaude(userPrompt);
  if (!result) {
    return new Response(JSON.stringify({ error: 'AI did not return valid JSON' }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  await sb.from('contacts').update({
    quality_label: result.label,
    quality_score: result.score,
    quality_reason: result.reason,
    qualified_at: new Date().toISOString(),
  }).eq('id', contact_id);

  return new Response(JSON.stringify({
    contact_id,
    label: result.label,
    score: result.score,
    reason: result.reason,
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
