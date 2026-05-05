// Analiza con IA las negociaciones caídas y devuelve un resumen accionable.
// Lee property_negotiations status=caida + notes + closed_reason del último período
// y llama Claude Sonnet para agrupar por causa raíz y sugerir acciones.

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

const SYSTEM_PROMPT = `Sos un analista comercial de inmobiliaria (Turdo Group, Mar del Plata).

Tu trabajo: leer una lista de negociaciones que NO se cerraron ("caídas") y armar un análisis ejecutivo en español argentino.

LO QUE TENÉS QUE PRODUCIR:
1. Top 5 causas raíz agrupadas (no copiadas literal — agrupadas por temática) con porcentaje aproximado.
2. Por cada causa, 1 acción concreta y aplicable.
3. Patrón temporal o por vendedor SI se nota algo.
4. 2-3 quick wins de la próxima semana.

REGLAS:
- Español argentino (vos, dale).
- Concreto. NO genérico.
- Si una causa es "el cliente desapareció" o "no contestó más", agrupala con "lead frío" — eso indica problema de seguimiento, no del cliente.
- Si la causa real es precio, separá entre "precio alto del dueño" y "presupuesto bajo del comprador" porque las acciones son distintas.
- Si los datos son pocos (< 5 caídas), aclará que la muestra es chica.

OUTPUT en JSON estricto, sin markdown:
{
  "summary": "1-2 frases con la idea principal",
  "top_causes": [
    {"label": "...", "pct": 0-100, "action": "..."}
  ],
  "patterns": ["..."],
  "quick_wins": ["..."],
  "sample_size": <número de caídas analizadas>
}`;

interface Negotiation {
  id: string;
  contact_name: string | null;
  agent_name: string | null;
  property_address: string | null;
  notes: string | null;
  closed_reason: string | null;
  closed_at: string | null;
  days_open: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: { since?: string; until?: string };
  try { body = await req.json(); } catch { body = {}; }

  const since = body.since ?? new Date(Date.now() - 90 * 86400000).toISOString();
  const until = body.until ?? new Date().toISOString();

  // Fetch caídas + nombres relacionados
  const { data: rows, error } = await sb
    .from('property_negotiations')
    .select(`
      id, notes, closed_reason, closed_at, created_at,
      contact:contacts(name),
      agent:agents(name),
      property:properties(address)
    `)
    .eq('status', 'caida')
    .gte('closed_at', since)
    .lte('closed_at', until)
    .limit(80);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const negs: Negotiation[] = (rows ?? []).map((r) => {
    const rec = r as Record<string, unknown>;
    const contact = rec.contact as { name?: string | null } | null;
    const agent = rec.agent as { name?: string | null } | null;
    const property = rec.property as { address?: string | null } | null;
    const created = new Date(rec.created_at as string).getTime();
    const closed = rec.closed_at ? new Date(rec.closed_at as string).getTime() : Date.now();
    return {
      id: rec.id as string,
      contact_name: contact?.name ?? null,
      agent_name: agent?.name ?? null,
      property_address: property?.address ?? null,
      notes: (rec.notes as string | null) ?? null,
      closed_reason: (rec.closed_reason as string | null) ?? null,
      closed_at: (rec.closed_at as string | null) ?? null,
      days_open: Math.max(1, Math.round((closed - created) / 86400000)),
    };
  });

  if (negs.length === 0) {
    return new Response(JSON.stringify({
      summary: 'No hay negociaciones caídas en el período seleccionado.',
      top_causes: [],
      patterns: [],
      quick_wins: [],
      sample_size: 0,
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const data = negs.map((n, i) =>
    `${i+1}. ${n.contact_name ?? 'Sin nombre'} con ${n.agent_name ?? 'sin asignar'} — ${n.property_address ?? 'propiedad ?'} | razón: ${n.closed_reason ?? '(sin especificar)'} | ${n.days_open} días abierta${n.notes ? ` | nota: ${n.notes.slice(0,200)}` : ''}`
  ).join('\n');

  const userPrompt = `Tenés ${negs.length} negociaciones que se cayeron entre ${since.slice(0,10)} y ${until.slice(0,10)}:

${data}

Analizá y devolvé el JSON pedido.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    return new Response(JSON.stringify({ error: 'AI service error', detail: errText.slice(0, 200) }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const aiData = await resp.json();
  const text: string = aiData?.content?.[0]?.text ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    return new Response(JSON.stringify({ error: 'No JSON in response', raw: text.slice(0, 300) }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const parsed = JSON.parse(m[0]);
    parsed.sample_size = negs.length;
    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON from AI', raw: m[0].slice(0, 300) }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
