// Edge function: Asistente IA para Turdo CRM con STREAMING.
// Stream end-to-end: Anthropic streaming → SSE al frontend.
// Tool use intercalado: cuando Claude pide una tool, ejecutamos y reanudamos stream.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Whitelist de orígenes. Bloquea uso de la edge function desde fuera del CRM
// (importante porque consume Anthropic API y se factura por uso).
const ALLOWED_ORIGINS = [
  'https://crm-turdo.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];
const isPreviewVercel = (o: string) => /^https:\/\/crm-turdo-[a-z0-9]+-jipisacane-5891s-projects\.vercel\.app$/.test(o);

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

const buildSseHeaders = (cors: Record<string, string>) => ({
  ...cors,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
});

// ── Tool labels para mostrar en UI ─────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  consultar_embudo: 'Revisando el embudo del equipo…',
  consultar_tiempo_respuesta: 'Calculando tiempos de respuesta…',
  consultar_conversion_canal: 'Analizando canales…',
  consultar_forecast: 'Calculando forecast del mes…',
  consultar_caidas: 'Mirando negociaciones caídas…',
  consultar_ciclo_venta: 'Calculando ciclo de venta…',
  consultar_leads_sin_asignar: 'Buscando leads sin asignar…',
  consultar_leads_sin_responder: 'Detectando leads fríos…',
  consultar_vendedores: 'Listando vendedores…',
  consultar_propiedades: 'Buscando propiedades…',
  consultar_negociaciones_activas: 'Mirando negociaciones activas…',
  consultar_operaciones_pendientes: 'Listando ventas pendientes…',
  consultar_resumen_general: 'Armando resumen general…',
  recordar: '💾 Guardando en memoria…',
  olvidar: '🗑️ Borrando memoria…',
};

// ── Tools (mismas que antes) ────────────────────────────────────────────────

const TOOLS = [
  { name: 'consultar_embudo', description: 'Devuelve el embudo de conversión (leads → contactados → negociaciones → ventas) por vendedor o total.', input_schema: { type: 'object', properties: { agent_key: { type: 'string' } } } },
  { name: 'consultar_tiempo_respuesta', description: 'Estadísticas de tiempo de primera respuesta (mediana, promedio, P90) y tasa de respuesta.', input_schema: { type: 'object', properties: {} } },
  { name: 'consultar_conversion_canal', description: 'Conversión por canal (whatsapp, instagram, facebook, web, zonaprop, etc.).', input_schema: { type: 'object', properties: {} } },
  { name: 'consultar_forecast', description: 'Forecast de comisiones de Turdo del mes en curso.', input_schema: { type: 'object', properties: {} } },
  { name: 'consultar_caidas', description: 'Motivos de negociaciones caídas + días promedio hasta caer.', input_schema: { type: 'object', properties: {} } },
  { name: 'consultar_ciclo_venta', description: 'Ciclo de venta promedio (días) por vendedor y por canal.', input_schema: { type: 'object', properties: {} } },
  { name: 'consultar_leads_sin_asignar', description: 'Cantidad y detalle de leads sin asignar a vendedor.', input_schema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'consultar_leads_sin_responder', description: 'Leads asignados pero sin respuesta del vendedor.', input_schema: { type: 'object', properties: { horas_minimas: { type: 'number' } } } },
  { name: 'consultar_vendedores', description: 'Lista de vendedores activos.', input_schema: { type: 'object', properties: {} } },
  { name: 'consultar_propiedades', description: 'Propiedades cargadas en el CRM.', input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['disponible', 'reservada', 'vendida', 'archivada'] } } } },
  { name: 'consultar_negociaciones_activas', description: 'Negociaciones activas por vendedor.', input_schema: { type: 'object', properties: { agent_key: { type: 'string' } } } },
  { name: 'consultar_operaciones_pendientes', description: 'Ventas pendientes de aprobación de Leticia.', input_schema: { type: 'object', properties: {} } },
  { name: 'consultar_resumen_general', description: 'Resumen general del CRM: totales y comisiones del mes.', input_schema: { type: 'object', properties: {} } },
  { name: 'recordar', description: 'Guarda un dato importante en memoria persistente para conversaciones futuras. Usalo proactivamente cuando el usuario te diga preferencias, info del equipo o reglas aplicables a futuro. NO uses para datos volátiles.', input_schema: { type: 'object', properties: { category: { type: 'string', enum: ['preference', 'team', 'business', 'deadline', 'general'] }, content: { type: 'string' }, importance: { type: 'number' } }, required: ['category', 'content'] } },
  { name: 'olvidar', description: 'Borra un hecho de memoria por id. Usalo si el usuario dice "olvidate eso" o "ya no aplica".', input_schema: { type: 'object', properties: { memory_id: { type: 'string' } }, required: ['memory_id'] } },
];

// ── Implementación tools ────────────────────────────────────────────────────

let _currentUserEmail = '';

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'consultar_embudo': {
      const q = sb.from('v_funnel_by_agent').select('*');
      if (input.agent_key) q.eq('agent_key', input.agent_key);
      const { data } = await q;
      return { rows: data ?? [] };
    }
    case 'consultar_tiempo_respuesta': {
      const { data } = await sb.from('v_response_time').select('*');
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
      const { data } = await sb.from('v_conversion_by_channel').select('*');
      return { rows: data ?? [] };
    }
    case 'consultar_forecast': {
      const { data } = await sb.from('v_forecast_summary').select('*').single();
      const r = data as Record<string, number>;
      const total = Number(r.comisiones_confirmadas_usd) + Number(r.forecast_pending_usd) + Number(r.forecast_negotiations_usd);
      return { ...r, total_estimado_usd: total };
    }
    case 'consultar_caidas': {
      const { data } = await sb.from('v_caidas_reasons').select('*');
      return { rows: data ?? [] };
    }
    case 'consultar_ciclo_venta': {
      const { data } = await sb.from('v_sale_cycle').select('*');
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
        by_vendor: Array.from(byVendor.entries()).map(([name, v]) => ({ name, total: v.total, avg_days: v.days.length > 0 ? Math.round(v.days.reduce((a, b) => a + b, 0) / v.days.length) : null })),
        by_channel: Array.from(byChannel.entries()).map(([name, v]) => ({ name, total: v.total, avg_days: v.days.length > 0 ? Math.round(v.days.reduce((a, b) => a + b, 0) / v.days.length) : null })),
      };
    }
    case 'consultar_leads_sin_asignar': {
      const limit = Number(input.limit ?? 20);
      const { data } = await sb.from('contacts').select('id, name, phone, channel, created_at, status, property_title').is('assigned_to', null).order('created_at', { ascending: false }).limit(limit);
      const { count } = await sb.from('contacts').select('id', { count: 'exact', head: true }).is('assigned_to', null);
      return { rows: data ?? [], total_sin_asignar: count ?? 0 };
    }
    case 'consultar_leads_sin_responder': {
      const horas = Number(input.horas_minimas ?? 24);
      const cutoff = new Date(Date.now() - horas * 3600 * 1000).toISOString();
      const { data } = await sb.from('v_response_time').select('*').is('first_out_at', null).lt('contact_created', cutoff).limit(50);
      return { rows: data ?? [], horas_minimas: horas };
    }
    case 'consultar_vendedores': {
      const { data } = await sb.from('agents').select('id, name, email, role, branch').eq('active', true).eq('role', 'agent');
      return { rows: data ?? [] };
    }
    case 'consultar_propiedades': {
      let q = sb.from('properties').select('id, address, barrio, list_price_usd, status, tokko_sku, created_at');
      if (input.status) q = q.eq('status', input.status);
      const { data } = await q.order('created_at', { ascending: false }).limit(50);
      return { rows: data ?? [] };
    }
    case 'consultar_negociaciones_activas': {
      let q = sb.from('v_negotiations_active').select('*');
      if (input.agent_key) q = q.eq('agent_id', input.agent_key);
      const { data } = await q;
      return { rows: data ?? [] };
    }
    case 'consultar_operaciones_pendientes': {
      const { data } = await sb.from('v_operations_pending_approval').select('*');
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
      return { contactos_total: contacts.count ?? 0, mensajes_total: messages.count ?? 0, propiedades_total: properties.count ?? 0, operaciones_total: operations.count ?? 0, comisiones_mes_usd: commTotal, negociaciones_activas: neg.count ?? 0, vendedores_activos: agents.count ?? 0 };
    }
    case 'recordar': {
      const cat = (input.category as string) ?? 'general';
      const content = (input.content as string) ?? '';
      const importance = Number(input.importance ?? 3);
      if (!content.trim()) return { error: 'content vacío' };
      const { data, error } = await sb.from('assistant_memories').insert({ user_email: _currentUserEmail, category: cat, content: content.trim(), importance }).select('id').single();
      if (error) throw error;
      return { saved: true, memory: data };
    }
    case 'olvidar': {
      const id = input.memory_id as string;
      if (!id) return { error: 'memory_id requerido' };
      await sb.from('assistant_memories').delete().eq('id', id).eq('user_email', _currentUserEmail);
      return { deleted: true, id };
    }
    default:
      return { error: `Tool desconocida: ${name}` };
  }
}

async function loadMemories(userEmail: string): Promise<Array<{ id: string; category: string; content: string; importance: number }>> {
  const { data, error } = await sb
    .from('assistant_memories')
    .select('id, category, content, importance')
    .eq('user_email', userEmail)
    .order('importance', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(40);
  if (error) {
    console.error('Error cargando memorias', error);
    return [];
  }
  return data ?? [];
}

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT_BASE = `Sos el Asistente IA del CRM de Turdo Group, una inmobiliaria de Mar del Plata.
Hablás siempre en **español argentino** (vos, tuteo).

Tu rol:
- Responder preguntas sobre el negocio usando las tools disponibles
- Números reales, no inventes. Si una tool devuelve 0, decilo claramente.
- Sumá interpretación: "viene bien/mal porque X"
- Sé conciso. Sin cortesías largas. Bullets o tabla cuando hay varios números.

Modelo de negocio:
- Turdo cobra 6% sobre cada venta. Vendedor escalonado sobre el 6%: 1ra venta del mes 20%, 2da 25%, 3ra+ 30%. Sin sueldo fijo.
- 7 vendedores: Andrea, Esteban, Gian Sabino, Rodrigo, Tomás Gorlero, Ulises Frits, Yamila Silva.
- Estados venta: pendiente → aprobada → pagada (o rechazada).
- Negociaciones: marcadas por vendedor antes del boleto. Cierran en venta o caída.

CRM en fase de desarrollo. Si tools devuelven poco, aclaralo: "se va a poblar a medida que el equipo use el sistema".

CUANDO EL USUARIO PREGUNTA SOBRE TUS CAPACIDADES:
- Si te pregunta "podrías hacer X?" / "se puede hacer Y?" / "qué cosas hacés?" → respondé DIRECTAMENTE en texto, NO uses tools.
- Sé honesto sobre qué podés (consultar datos del CRM con tus tools) y qué NO podés todavía (acciones como asignar leads, mandar mensajes, modificar datos — eso vendría en futuras versiones).
- Si te piden algo que no podés hacer aún, decilo claro y sugerí cómo se podría implementar a futuro.

MEMORIA — usá 'recordar' y 'olvidar' proactivamente:
- Preferencias del usuario, info del equipo, reglas aplicables a futuro → guardar SIN que te lo pidan.
- "olvidate de X" → usar 'olvidar' con el id.
- NO guardes datos volátiles.
- Después de guardar mencionalo: "✓ Lo guardé en memoria".

REGLA CRÍTICA: SIEMPRE respondé con texto al usuario. Aunque uses tools, después generá una respuesta en texto explicando lo que encontraste o pensás. Nunca termines sin texto.`;

// ── Streaming ───────────────────────────────────────────────────────────────

interface ContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[] | Array<{ type: 'tool_result'; tool_use_id: string; content: string }>;
}

interface StreamingTurnResult {
  contentBlocks: ContentBlock[];
  stopReason: string;
}

/**
 * Llama a Anthropic con stream=true y procesa events SSE.
 * Por cada delta de texto, envía un SSE al cliente.
 * Por cada tool_use_start, envía un SSE indicador.
 * Devuelve los content blocks completos cuando termina.
 */
async function streamClaude(
  messages: ChatMessage[],
  systemPrompt: string,
  send: (event: string, data: unknown) => void,
): Promise<StreamingTurnResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      stream: true,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    }),
  });

  if (!res.ok || !res.body) {
    const txt = await res.text();
    throw new Error(`Claude API ${res.status}: ${txt}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const contentBlocks: ContentBlock[] = [];
  const partialJsonByIndex = new Map<number, string>();
  let stopReason = 'end_turn';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const ev = JSON.parse(payload) as Record<string, unknown>;
        const type = ev.type as string;

        if (type === 'content_block_start') {
          const idx = ev.index as number;
          const block = ev.content_block as ContentBlock;
          contentBlocks[idx] = { ...block };
          if (block.type === 'tool_use' && block.name) {
            send('tool_start', { name: block.name, label: TOOL_LABELS[block.name] ?? `Ejecutando ${block.name}…` });
          }
        } else if (type === 'content_block_delta') {
          const idx = ev.index as number;
          const delta = ev.delta as { type: string; text?: string; partial_json?: string };
          if (delta.type === 'text_delta' && delta.text) {
            contentBlocks[idx] = { ...contentBlocks[idx], text: (contentBlocks[idx]?.text ?? '') + delta.text };
            send('text_delta', { text: delta.text });
          } else if (delta.type === 'input_json_delta' && delta.partial_json) {
            partialJsonByIndex.set(idx, (partialJsonByIndex.get(idx) ?? '') + delta.partial_json);
          }
        } else if (type === 'content_block_stop') {
          const idx = ev.index as number;
          if (contentBlocks[idx]?.type === 'tool_use') {
            const partial = partialJsonByIndex.get(idx) ?? '';
            try {
              contentBlocks[idx].input = partial ? JSON.parse(partial) : {};
            } catch {
              contentBlocks[idx].input = {};
            }
          }
        } else if (type === 'message_delta') {
          const delta = ev.delta as { stop_reason?: string };
          if (delta.stop_reason) stopReason = delta.stop_reason;
        }
      } catch (e) {
        console.error('SSE parse error', e, payload);
      }
    }
  }

  return { contentBlocks, stopReason };
}

// ── Handler principal ──────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const cors = buildCors(req);
  if (!cors) return new Response('Forbidden origin', { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const body = await req.json() as { history?: ChatMessage[]; question: string; role?: string; user_email?: string };
  if (!body.question?.trim()) {
    return new Response(JSON.stringify({ error: 'Falta la pregunta' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (body.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Solo admin' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  _currentUserEmail = body.user_email ?? 'leticia@turdogroup.com';

  // Stream response al cliente
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const memories = await loadMemories(_currentUserEmail);
        let systemPrompt = SYSTEM_PROMPT_BASE;
        if (memories.length > 0) {
          const memText = memories.map(m => `[id:${m.id}] (${m.category}, ${m.importance}/5): ${m.content}`).join('\n');
          systemPrompt += `\n\n=== MEMORIAS GUARDADAS ===\n${memText}\n=== FIN ===`;
        }

        const history = body.history ?? [];
        const messages: ChatMessage[] = [...history, { role: 'user', content: body.question.trim() }];

        // Loop de tool use con streaming
        let accumulatedText = '';
        let lastStopReason = 'end_turn';
        for (let i = 0; i < 6; i++) {
          const { contentBlocks, stopReason } = await streamClaude(messages, systemPrompt, send);
          lastStopReason = stopReason;

          // Sumar texto acumulado de este turn
          for (const block of contentBlocks) {
            if (block.type === 'text' && block.text) accumulatedText += block.text;
          }

          if (stopReason !== 'tool_use') break;

          // Ejecutar tools y reanudar
          messages.push({ role: 'assistant', content: contentBlocks });
          const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
          for (const block of contentBlocks) {
            if (block.type !== 'tool_use' || !block.id || !block.name) continue;
            try {
              const result = await executeTool(block.name, block.input ?? {});
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
            } catch (e) {
              console.error('Tool error', block.name, e);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: (e as Error).message }) });
            }
          }
          messages.push({ role: 'user', content: toolResults });
        }

        // Defensa: si terminó sin texto, pedir explícitamente una respuesta
        if (!accumulatedText.trim()) {
          console.log('No accumulated text after loop, retrying with explicit text request. lastStopReason:', lastStopReason);
          messages.push({ role: 'user', content: 'Respondeme con texto a mi pregunta original, sin usar más tools. Si no podés hacer lo que te pedí, explicame por qué.' });
          await streamClaude(messages, systemPrompt, send);
        }

        send('done', { ok: true });
      } catch (e) {
        send('error', { message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: buildSseHeaders(cors) });
});
