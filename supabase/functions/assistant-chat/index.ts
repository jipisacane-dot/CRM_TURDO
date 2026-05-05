// Edge function: Asistente IA para Turdo CRM
// Usa Claude (Anthropic API) con tool use para responder preguntas sobre el negocio.
// Las tools consultan vistas SQL del CRM y devuelven JSON al modelo.
//
// Auth: requiere que el caller mande role=admin (Leticia). Vendedores en V2.
//
// Cost: con prompt caching activado, ~$0.005-0.01 por pregunta con Sonnet 4.5.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Tools que el modelo puede usar ──────────────────────────────────────────

const TOOLS = [
  {
    name: 'consultar_embudo',
    description: 'Devuelve el embudo de conversión (leads → contactados → negociaciones → ventas) por vendedor o total. Útil para ver cómo viene cada vendedor.',
    input_schema: {
      type: 'object',
      properties: {
        agent_key: { type: 'string', description: 'Filtrar por un agente específico (ej. id de agente). Si se omite, devuelve todos.' },
      },
    },
  },
  {
    name: 'consultar_tiempo_respuesta',
    description: 'Devuelve estadísticas de tiempo de primera respuesta a leads (mediana, promedio, P90) y la tasa de respuesta. Útil para evaluar qué tan rápido contesta el equipo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_conversion_canal',
    description: 'Devuelve la conversión por canal (whatsapp, instagram, facebook, web, zonaprop, etc.): cuántos leads vienen y cuántos terminan en venta. Útil para evaluar qué canal funciona mejor.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_forecast',
    description: 'Devuelve el forecast de comisiones de Turdo del mes en curso: confirmadas + probables (ventas pendientes) + posibles (negociaciones).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_caidas',
    description: 'Devuelve los motivos de las negociaciones que se cayeron y el promedio de días hasta caer.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_ciclo_venta',
    description: 'Devuelve el ciclo de venta promedio (días desde primer contacto hasta firma de boleto) por vendedor y por canal.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_leads_sin_asignar',
    description: 'Devuelve la cantidad y detalle de leads que aún no fueron asignados a ningún vendedor.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Cantidad máxima de leads a devolver (default 20).' },
      },
    },
  },
  {
    name: 'consultar_leads_sin_responder',
    description: 'Devuelve los leads asignados pero sin respuesta del vendedor. Sirve para detectar leads fríos.',
    input_schema: {
      type: 'object',
      properties: {
        horas_minimas: { type: 'number', description: 'Solo leads con más de N horas sin respuesta (default 24).' },
      },
    },
  },
  {
    name: 'consultar_vendedores',
    description: 'Devuelve la lista de vendedores activos del equipo con sus datos básicos (nombre, sucursal).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_propiedades',
    description: 'Devuelve la lista de propiedades en el CRM (no incluye Tokko). Útil para ver qué hay cargado internamente.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['disponible', 'reservada', 'vendida', 'archivada'], description: 'Filtrar por estado.' },
      },
    },
  },
  {
    name: 'consultar_negociaciones_activas',
    description: 'Devuelve las negociaciones activas (en proceso, antes del boleto), por vendedor.',
    input_schema: {
      type: 'object',
      properties: {
        agent_key: { type: 'string', description: 'Filtrar por un vendedor específico.' },
      },
    },
  },
  {
    name: 'consultar_operaciones_pendientes',
    description: 'Devuelve las ventas cargadas que están pendientes de aprobación de Leticia.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_resumen_general',
    description: 'Devuelve un resumen general del estado del CRM: totales de contactos, mensajes, propiedades, operaciones, comisiones del mes.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ── Implementación de cada tool ──────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'consultar_embudo': {
      const q = sb.from('v_funnel_by_agent').select('*');
      if (input.agent_key) q.eq('agent_key', input.agent_key);
      const { data, error } = await q;
      if (error) throw error;
      return { rows: data ?? [], total: data?.length ?? 0 };
    }
    case 'consultar_tiempo_respuesta': {
      const { data, error } = await sb.from('v_response_time').select('*');
      if (error) throw error;
      const rows = data ?? [];
      const respondidos = rows.filter((r: { response_minutes: number | null }) => r.response_minutes != null);
      const minutes: number[] = respondidos.map((r: { response_minutes: number }) => Number(r.response_minutes));
      const sorted = [...minutes].sort((a, b) => a - b);
      const median = sorted.length === 0 ? null
        : sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];
      const avg = minutes.length === 0 ? null : minutes.reduce((a, b) => a + b, 0) / minutes.length;
      return {
        total_leads: rows.length,
        respondidos: respondidos.length,
        no_respondidos: rows.length - respondidos.length,
        tasa_respuesta_pct: rows.length > 0 ? Math.round(respondidos.length / rows.length * 1000) / 10 : 0,
        avg_response_minutes: avg != null ? Math.round(avg * 10) / 10 : null,
        median_response_minutes: median != null ? Math.round(median * 10) / 10 : null,
      };
    }
    case 'consultar_conversion_canal': {
      const { data, error } = await sb.from('v_conversion_by_channel').select('*');
      if (error) throw error;
      return { rows: data ?? [] };
    }
    case 'consultar_forecast': {
      const { data, error } = await sb.from('v_forecast_summary').select('*').single();
      if (error) throw error;
      const r = data as Record<string, number>;
      const total = Number(r.comisiones_confirmadas_usd) + Number(r.forecast_pending_usd) + Number(r.forecast_negotiations_usd);
      return { ...r, total_estimado_usd: total };
    }
    case 'consultar_caidas': {
      const { data, error } = await sb.from('v_caidas_reasons').select('*');
      if (error) throw error;
      return { rows: data ?? [] };
    }
    case 'consultar_ciclo_venta': {
      const { data, error } = await sb.from('v_sale_cycle').select('*');
      if (error) throw error;
      const rows = data ?? [];
      const byVendor = new Map<string, { total: number; days: number[] }>();
      const byChannel = new Map<string, { total: number; days: number[] }>();
      for (const r of rows as Array<{ vendedor_name: string | null; channel: string | null; days_to_close: number | null }>) {
        const v = r.vendedor_name ?? '—';
        const c = r.channel ?? '—';
        const cur1 = byVendor.get(v) ?? { total: 0, days: [] };
        cur1.total++;
        if (r.days_to_close != null) cur1.days.push(Number(r.days_to_close));
        byVendor.set(v, cur1);
        const cur2 = byChannel.get(c) ?? { total: 0, days: [] };
        cur2.total++;
        if (r.days_to_close != null) cur2.days.push(Number(r.days_to_close));
        byChannel.set(c, cur2);
      }
      const validDays = rows.map((r: { days_to_close: number | null }) => r.days_to_close).filter((d): d is number => d != null);
      return {
        total: rows.length,
        avg_days: validDays.length > 0 ? Math.round(validDays.reduce((a, b) => a + b, 0) / validDays.length) : null,
        by_vendor: Array.from(byVendor.entries()).map(([name, v]) => ({
          name,
          total: v.total,
          avg_days: v.days.length > 0 ? Math.round(v.days.reduce((a, b) => a + b, 0) / v.days.length) : null,
        })),
        by_channel: Array.from(byChannel.entries()).map(([name, v]) => ({
          name,
          total: v.total,
          avg_days: v.days.length > 0 ? Math.round(v.days.reduce((a, b) => a + b, 0) / v.days.length) : null,
        })),
      };
    }
    case 'consultar_leads_sin_asignar': {
      const limit = Number(input.limit ?? 20);
      const { data, error } = await sb
        .from('contacts')
        .select('id, name, phone, channel, created_at, status, property_title')
        .is('assigned_to', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      const { count } = await sb.from('contacts').select('id', { count: 'exact', head: true }).is('assigned_to', null);
      return { rows: data ?? [], total_sin_asignar: count ?? 0 };
    }
    case 'consultar_leads_sin_responder': {
      const horas = Number(input.horas_minimas ?? 24);
      const cutoff = new Date(Date.now() - horas * 3600 * 1000).toISOString();
      const { data, error } = await sb
        .from('v_response_time')
        .select('*')
        .is('first_out_at', null)
        .lt('contact_created', cutoff)
        .limit(50);
      if (error) throw error;
      return { rows: data ?? [], horas_minimas: horas };
    }
    case 'consultar_vendedores': {
      const { data, error } = await sb
        .from('agents')
        .select('id, name, email, role, branch')
        .eq('active', true)
        .eq('role', 'agent');
      if (error) throw error;
      return { rows: data ?? [] };
    }
    case 'consultar_propiedades': {
      let q = sb.from('properties').select('id, address, barrio, list_price_usd, status, tokko_sku, created_at');
      if (input.status) q = q.eq('status', input.status);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return { rows: data ?? [] };
    }
    case 'consultar_negociaciones_activas': {
      let q = sb
        .from('v_negotiations_active')
        .select('*');
      if (input.agent_key) q = q.eq('agent_id', input.agent_key);
      const { data, error } = await q;
      if (error) throw error;
      return { rows: data ?? [] };
    }
    case 'consultar_operaciones_pendientes': {
      const { data, error } = await sb.from('v_operations_pending_approval').select('*');
      if (error) throw error;
      return { rows: data ?? [] };
    }
    case 'consultar_resumen_general': {
      const [contacts, messages, properties, operations, commissions, neg, agents] = await Promise.all([
        sb.from('contacts').select('id', { count: 'exact', head: true }),
        sb.from('messages').select('id', { count: 'exact', head: true }),
        sb.from('properties').select('id', { count: 'exact', head: true }),
        sb.from('operations').select('id', { count: 'exact', head: true }),
        sb.from('commissions').select('monto_usd').eq('active', true).gte('mes_liquidacion', new Date().toISOString().slice(0, 7) + '-01'),
        sb.from('property_negotiations').select('id', { count: 'exact', head: true }).eq('status', 'activa'),
        sb.from('agents').select('id', { count: 'exact', head: true }).eq('active', true),
      ]);
      const commTotal = (commissions.data ?? []).reduce((s: number, c: { monto_usd: number }) => s + Number(c.monto_usd), 0);
      return {
        contactos_total: contacts.count ?? 0,
        mensajes_total: messages.count ?? 0,
        propiedades_total: properties.count ?? 0,
        operaciones_total: operations.count ?? 0,
        comisiones_mes_usd: commTotal,
        negociaciones_activas: neg.count ?? 0,
        vendedores_activos: agents.count ?? 0,
      };
    }
    default:
      return { error: `Tool desconocida: ${name}` };
  }
}

// ── Sistema de chat con loop de tool use ──────────────────────────────────────

const SYSTEM_PROMPT = `Sos el Asistente IA del CRM de Turdo Group, una inmobiliaria de Mar del Plata.
Tu interlocutora principal es Leticia Turdo (admin/dueña). Hablás siempre en **español argentino** (vos, tuteo, modismos naturales).

Tu rol:
- Responder preguntas sobre el negocio usando las tools disponibles
- Dar respuestas concretas con números reales (no inventes)
- Cuando una tool devuelve 0 datos o vacío, decilo claramente. No mientas con datos.
- Sumar contexto útil: si Leti pregunta "cómo viene Gian", no respondas solo con números, dale interpretación: "viene bien / mal porque X"
- Sé conciso. No envuelvas las respuestas en cortesías largas.
- Cuando la respuesta tiene varios números, presentalos en formato bullets o tabla simple para que se lea rápido.

Sobre el modelo del negocio:
- Turdo cobra 6% de comisión sobre cada venta de propiedad
- Vendedor cobra escalonado sobre ese 6%: 1ra venta del mes = 20% del 6%, 2da = 25%, 3ra+ = 30%
- Sin sueldo fijo. Solo comisiones.
- 7 vendedores activos: Andrea, Esteban, Gian Sabino, Rodrigo, Tomás Gorlero, Ulises Frits, Yamila Silva.
- Estados de venta: pendiente → aprobada (por Leti) → pagada. O rechazada.
- Negociaciones: el vendedor marca propiedades en negociación antes del boleto. Pueden cerrar en venta (cerrada) o caída.

IMPORTANTE: el CRM está en fase de desarrollo. Muchas métricas todavía van a estar vacías o con datos limitados. Si una tool devuelve poco/nada, aclaralo: "todavía no hay X cargado, esto se va a poblar a medida que el equipo use el sistema".

Si Leti pregunta algo que no podés responder con tus tools, decile claramente que no tenés esa info y sugerí qué tool similar podría servir.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: string }>;
}

interface ClaudeResponse {
  id: string;
  content: Array<{ type: 'text' | 'tool_use'; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

async function callClaude(messages: ChatMessage[]): Promise<ClaudeResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: [
        // Cache prompt sistema + tools (no cambian, ahorra mucho)
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      tools: TOOLS.map(t => ({ ...t, cache_control: undefined })),
      messages,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API error ${res.status}: ${txt}`);
  }
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });

  try {
    const body = await req.json() as { history?: ChatMessage[]; question: string; role?: string };
    if (!body.question?.trim()) {
      return new Response(JSON.stringify({ error: 'Falta la pregunta' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    if (body.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Solo admin tiene acceso al asistente por ahora' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const history = body.history ?? [];
    const messages: ChatMessage[] = [
      ...history,
      { role: 'user', content: body.question.trim() },
    ];

    let usage = { input: 0, output: 0, cache_read: 0, cache_create: 0 };

    // Loop de tool use: hasta 6 iteraciones para no quedar infinito
    let response: ClaudeResponse | null = null;
    for (let i = 0; i < 6; i++) {
      response = await callClaude(messages);
      usage.input += response.usage?.input_tokens ?? 0;
      usage.output += response.usage?.output_tokens ?? 0;
      usage.cache_read += response.usage?.cache_read_input_tokens ?? 0;
      usage.cache_create += response.usage?.cache_creation_input_tokens ?? 0;

      if (response.stop_reason !== 'tool_use') break;

      // Encontrar todos los tool_use blocks y ejecutarlos
      const toolUses = response.content.filter(c => c.type === 'tool_use');
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
      for (const tu of toolUses) {
        if (!tu.id || !tu.name) continue;
        try {
          const result = await executeTool(tu.name, (tu.input ?? {}) as Record<string, unknown>);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          });
        } catch (e) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify({ error: (e as Error).message }),
          });
        }
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
    }

    // Extraer texto final
    const finalText = response?.content
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n')
      .trim() ?? 'No pude responder a tu pregunta.';

    return new Response(JSON.stringify({
      answer: finalText,
      usage,
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
