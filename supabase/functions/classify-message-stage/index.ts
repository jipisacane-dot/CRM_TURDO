// Edge function: Auto-clasifica el lead en una etapa del pipeline cuando llega un mensaje.
// Llama Claude Haiku para detectar intent y, si hay un match con suficiente confianza,
// actualiza contacts.current_stage_key + registra en contact_stage_changes (auto_detected=true).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MIN_CONFIDENCE = 0.7;
const TERMINAL_STAGES = new Set(['ganado', 'perdido']);

interface ClassifyResult {
  detected_stage: string | null;
  confidence: number;
  reason: string;
}

const SYSTEM_PROMPT = `Sos un clasificador de leads inmobiliarios de Turdo (Mar del Plata, Argentina).

Tu trabajo: leer el último mensaje de la conversación entre un vendedor y un cliente y decidir si el lead debe pasar a una etapa nueva del pipeline.

ETAPAS DISPONIBLES (key → cuándo aplica):
- nuevo: primer contacto, todavía no hubo ida y vuelta real
- en_conversacion: hay diálogo activo, el cliente pregunta cosas o el vendedor le contesta
- visita_programada: acordaron una visita, fecha o referencia temporal concreta ("mañana", "el sábado", "te paso la dirección")
- propuesta_enviada: el vendedor envió una oferta, propuesta formal, precio firme o ficha
- en_negociacion: están negociando precio, condiciones, contraoferta, formas de pago
- en_pausa: el cliente pidió tiempo ("más adelante", "ahora no", "te aviso", "tengo que pensarlo")
- ganado: cerraron la operación (firmaron boleto, escrituraron, dijeron "lo compro", "cerramos")
- perdido: el cliente dijo NO, ya compró otra cosa, no le interesa más, "se cae" la operación

REGLAS:
1. Solo detectás CAMBIOS — si el mensaje no implica un cambio de etapa, devolvé detected_stage=null.
2. NO reclasifiques hacia atrás (ej: si el lead ya está en "en_negociacion", no lo bajes a "en_conversacion" salvo que el cliente lo reabra explícitamente).
3. Sé conservador: si no estás seguro, devolvé null. Confidence mínimo aceptable: 0.7. Por debajo, devolvé null.
4. Frases típicas argentinas:
   - "te visito", "paso a verlo", "el sábado lo veo" → visita_programada
   - "ya compré", "ya lo conseguí", "no me interesa más" → perdido
   - "lo pienso", "te aviso", "más adelante", "no es el momento" → en_pausa
   - "lo tomo", "cerremos", "firmemos", "hago la reserva" → ganado
   - "te ofrezco X", "lo bajamos a", "qué hacés con", "contraoferta" → en_negociacion
5. Si la conversación arranca de cero y el cliente pregunta algo concreto (precio, ubicación, ambientes), pasa de "nuevo" a "en_conversacion".

OUTPUT estricto en JSON, sin markdown, sin texto adicional:
{ "detected_stage": "key_de_la_etapa" | null, "confidence": 0.0-1.0, "reason": "explicación corta en español" }`;

interface MessageRow {
  id: string;
  content: string;
  direction: 'in' | 'out';
  created_at: string;
}

async function classify(args: {
  message: MessageRow;
  currentStage: string;
  recentMessages: MessageRow[];
}): Promise<ClassifyResult | null> {
  const { message, currentStage, recentMessages } = args;

  const conversationContext = recentMessages
    .slice(-6)
    .map(m => `${m.direction === 'in' ? 'CLIENTE' : 'VENDEDOR'}: ${m.content.slice(0, 300)}`)
    .join('\n');

  const userPrompt = `ETAPA ACTUAL DEL LEAD: ${currentStage}

ÚLTIMOS MENSAJES (orden cronológico):
${conversationContext}

ÚLTIMO MENSAJE (clasificar este):
${message.direction === 'in' ? 'CLIENTE' : 'VENDEDOR'}: ${message.content.slice(0, 500)}

Devolvé JSON con la clasificación.`;

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
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    console.error('Anthropic error', resp.status, await resp.text());
    return null;
  }

  const data = await resp.json();
  const text = data?.content?.[0]?.text ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('No JSON in Claude response:', text);
    return null;
  }
  try {
    return JSON.parse(jsonMatch[0]) as ClassifyResult;
  } catch (e) {
    console.error('Bad JSON:', jsonMatch[0], e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });

  let body: { contact_id?: string; message_id?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS_HEADERS }); }

  const { contact_id, message_id } = body;
  if (!contact_id) {
    return new Response(JSON.stringify({ error: 'contact_id required' }), { status: 400, headers: CORS_HEADERS });
  }

  // Fetch del contacto + últimos mensajes (orden cronológico). Si vino message_id usamos ese,
  // si no agarramos el último mensaje del contacto.
  const [{ data: contact }, { data: recent }] = await Promise.all([
    sb.from('contacts').select('current_stage_key').eq('id', contact_id).single(),
    sb.from('messages').select('id, content, direction, created_at').eq('contact_id', contact_id).order('created_at', { ascending: true }).limit(20),
  ]);

  if (!contact || !recent || recent.length === 0) {
    return new Response(JSON.stringify({ error: 'Contact or messages not found' }), { status: 404, headers: CORS_HEADERS });
  }

  const message = (message_id
    ? recent.find(m => m.id === message_id)
    : [...recent].reverse().find(m => m.direction === 'in')) ?? recent[recent.length - 1];

  if (!message) {
    return new Response(JSON.stringify({ error: 'No message to classify' }), { status: 404, headers: CORS_HEADERS });
  }

  const currentStage = contact.current_stage_key ?? 'nuevo';

  // Si ya está en etapa terminal, no reclasificar
  if (TERMINAL_STAGES.has(currentStage)) {
    return new Response(JSON.stringify({ skipped: true, reason: 'terminal_stage', current: currentStage }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const result = await classify({
    message: message as MessageRow,
    currentStage,
    recentMessages: (recent ?? []) as MessageRow[],
  });

  if (!result || !result.detected_stage || result.confidence < MIN_CONFIDENCE || result.detected_stage === currentStage) {
    return new Response(JSON.stringify({
      changed: false,
      current_stage: currentStage,
      detected: result?.detected_stage ?? null,
      confidence: result?.confidence ?? 0,
      reason: result?.reason ?? 'no_change_detected',
    }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // Validar que la etapa detectada exista
  const { data: stageExists } = await sb.from('pipeline_stages').select('key').eq('key', result.detected_stage).maybeSingle();
  if (!stageExists) {
    console.error('Claude devolvió etapa inválida:', result.detected_stage);
    return new Response(JSON.stringify({ changed: false, error: 'invalid_stage', detected: result.detected_stage }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Aplicar cambio: UPDATE contact + INSERT historial
  const now = new Date().toISOString();
  const reasonText = `IA: ${result.reason} (conf ${result.confidence.toFixed(2)})`;

  const [{ error: updErr }, { error: histErr }] = await Promise.all([
    sb.from('contacts').update({ current_stage_key: result.detected_stage, stage_changed_at: now }).eq('id', contact_id),
    sb.from('contact_stage_changes').insert({
      contact_id,
      from_stage: currentStage,
      to_stage: result.detected_stage,
      changed_by: null,
      changed_at: now,
      reason: reasonText,
      auto_detected: true,
    }),
  ]);

  if (updErr || histErr) {
    console.error('DB update error', { updErr, histErr });
    return new Response(JSON.stringify({ error: 'db_update_failed', updErr, histErr }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    changed: true,
    from: currentStage,
    to: result.detected_stage,
    confidence: result.confidence,
    reason: result.reason,
  }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
});
