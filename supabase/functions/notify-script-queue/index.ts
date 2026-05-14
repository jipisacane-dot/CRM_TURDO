// Edge function: notify-script-queue
// Se dispara cuando se inserta una fila en script_queue.
// 1. Lee la URL → llama a Claude para extraer datos clave de la propiedad
// 2. Manda mensaje a Telegram a Jipi con resumen + tracking_code
// 3. Actualiza script_queue con ai_summary + telegram_msg_id_out + status='notified'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TELEGRAM_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID_JIPI')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotifyRequest {
  script_queue_id: string;
}

async function summarizeProperty(url: string, note: string | null): Promise<string> {
  // Fetch HTML de la URL
  let html = '';
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TurdoBot/1.0)' },
      redirect: 'follow',
    });
    if (r.ok) {
      const raw = await r.text();
      // Recortamos a ~15K chars para no quemar tokens
      html = raw.slice(0, 15000);
    }
  } catch (e) {
    console.log('[notify-script-queue] fetch URL err:', e);
  }

  const userPrompt = `Esta es la URL de una propiedad inmobiliaria que Lety, dueña de la inmobiliaria Turdo en Mar del Plata, le pasó a Nacho (publicista) para que le arme un guion de reel.

URL: ${url}
${note ? `Nota de Lety: ${note}` : ''}

HTML de la página (recortado):
${html || '(no se pudo cargar el HTML)'}

Devolveme un resumen MUY CORTO en español argentino con los datos clave para que Nacho arme el guion:
- Tipo de propiedad y ambientes
- Ubicación / barrio
- Precio
- 2-3 features destacables (vista, reciclado, balcón, etc.)
- Algún ángulo de venta interesante que ves

Máximo 6 líneas, formato bullets cortos con "•". Si no podés inferir algo, NO lo inventes — decí "no se ve en la URL".`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!r.ok) {
      console.log('[notify-script-queue] Claude err:', r.status, await r.text());
      return '(no se pudo generar resumen automatico)';
    }
    const d = await r.json();
    return d.content?.[0]?.text ?? '(sin resumen)';
  } catch (e) {
    console.log('[notify-script-queue] Claude exception:', e);
    return '(error generando resumen)';
  }
}

async function sendTelegram(text: string, replyMarkup?: unknown): Promise<number | null> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: Number(TELEGRAM_CHAT_ID),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: replyMarkup,
      }),
    });
    const d = await r.json();
    if (!d.ok) {
      console.log('[notify-script-queue] Telegram err:', d);
      return null;
    }
    return d.result.message_id as number;
  } catch (e) {
    console.log('[notify-script-queue] Telegram exception:', e);
    return null;
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  let body: NotifyRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  if (!body.script_queue_id) {
    return new Response(JSON.stringify({ error: 'script_queue_id requerido' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Fetch del item
  const { data: item, error } = await supabase
    .from('script_queue')
    .select('*')
    .eq('id', body.script_queue_id)
    .maybeSingle();
  if (error || !item) {
    return new Response(JSON.stringify({ error: 'script_queue item no encontrado' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (item.status !== 'pending') {
    return new Response(JSON.stringify({ skipped: true, reason: `status=${item.status}` }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Resumen con Claude
  const summary = await summarizeProperty(item.url, item.note);

  // Mensaje Telegram
  const noteLine = item.note ? `\n💬 <b>Nota de ${escapeHtml(item.requested_by_name ?? 'Lety')}:</b>\n${escapeHtml(item.note)}\n` : '';
  const text = `🎬 <b>Nuevo pedido de guion · ${escapeHtml(item.tracking_code)}</b>
${noteLine}
📊 <b>Resumen IA:</b>
${escapeHtml(summary)}

🔗 ${escapeHtml(item.url)}

<i>Respondé citando este mensaje con el guion. Cuando lo mandes, vuelve directo al CRM.</i>`;

  const tgMsgId = await sendTelegram(text);

  // Update con summary + msg_id
  await supabase
    .from('script_queue')
    .update({
      ai_summary: summary,
      telegram_msg_id_out: tgMsgId,
      status: tgMsgId ? 'notified' : 'pending',
    })
    .eq('id', body.script_queue_id);

  return new Response(JSON.stringify({ ok: true, telegram_msg_id: tgMsgId, summary }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
