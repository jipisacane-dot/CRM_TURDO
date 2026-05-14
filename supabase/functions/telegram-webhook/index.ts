// Edge function: telegram-webhook
// Recibe updates de Telegram (mensajes que vos respondes al bot).
// Si el mensaje es una respuesta (reply) a un mensaje anterior del bot:
//   - Busca el script_queue cuyo telegram_msg_id_out coincide
//   - Guarda el texto como jipi_response, status='completed'
// Si el mensaje empieza con tracking_code (ej: "G-0042 Hook fuerte..."):
//   - Idem pero matcheando por código
// Si no, ignora.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TELEGRAM_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID_JIPI')!;
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';

async function ackReply(chatId: number, replyToMsgId: number, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_to_message_id: replyToMsgId,
        parse_mode: 'HTML',
      }),
    });
  } catch (e) {
    console.log('[telegram-webhook] ack err:', e);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  // Validar secret_token que Telegram envía como header en cada update.
  // Si TELEGRAM_WEBHOOK_SECRET no está configurado, pasa con warning (modo gracia
  // para no romper hasta que el user lo configure en setWebhook + Supabase secrets).
  if (TELEGRAM_WEBHOOK_SECRET) {
    const sig = req.headers.get('x-telegram-bot-api-secret-token');
    if (sig !== TELEGRAM_WEBHOOK_SECRET) {
      console.warn('[telegram-webhook] secret token inválido, rechazando');
      return new Response('Unauthorized', { status: 401 });
    }
  } else {
    console.warn('[telegram-webhook] TELEGRAM_WEBHOOK_SECRET no configurado — saltando validación');
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return new Response('ok', { status: 200 });
  }

  console.log('[telegram-webhook] update:', JSON.stringify(update).slice(0, 500));

  const msg = update.message as Record<string, unknown> | undefined;
  if (!msg) return new Response('ok', { status: 200 });

  const chatId = (msg.chat as Record<string, unknown>)?.id as number;
  const fromId = (msg.from as Record<string, unknown>)?.id as number;
  const text = (msg.text as string) ?? '';
  const messageId = msg.message_id as number;
  const replyTo = msg.reply_to_message as Record<string, unknown> | undefined;
  const replyToMsgId = replyTo?.message_id as number | undefined;

  // Solo aceptamos mensajes del chat de Jipi (seguridad básica)
  if (String(chatId) !== String(TELEGRAM_CHAT_ID)) {
    console.log('[telegram-webhook] chat ignorado:', chatId);
    return new Response('ok', { status: 200 });
  }

  // Ignorar comandos del bot (/start, /help, etc.)
  if (text.startsWith('/')) {
    if (text === '/start') {
      await ackReply(chatId, messageId, '👋 Hola Nacho! Cuando Lety pase una propiedad por el CRM, te aviso por acá.\n\nTambién podés <b>responder citando</b> mis mensajes para guardar el guion en el CRM automáticamente.');
    } else if (text === '/pendientes') {
      const { data: pendientes } = await supabase
        .from('script_queue')
        .select('tracking_code,url,created_at,note')
        .in('status', ['notified', 'in_progress'])
        .order('created_at', { ascending: true });
      const lista = (pendientes ?? []).map((p) => `• <b>${p.tracking_code}</b> · ${p.note ?? '(sin nota)'}\n  ${p.url}`).join('\n\n') || '(no hay pendientes 🎉)';
      await ackReply(chatId, messageId, `📋 <b>Guiones pendientes:</b>\n\n${lista}`);
    }
    return new Response('ok', { status: 200 });
  }

  // Identificar qué item de script_queue contesta este mensaje
  let item: Record<string, unknown> | null = null;

  // Opción 1: mensaje es REPLY a un msg del bot → matchear por telegram_msg_id_out
  if (replyToMsgId) {
    const { data } = await supabase
      .from('script_queue')
      .select('*')
      .eq('telegram_msg_id_out', replyToMsgId)
      .maybeSingle();
    if (data) item = data;
  }

  // Opción 2: el texto empieza con código G-XXXX
  if (!item) {
    const match = text.match(/^G-(\d{3,5})/i);
    if (match) {
      const code = 'G-' + match[1].padStart(4, '0');
      const { data } = await supabase
        .from('script_queue')
        .select('*')
        .eq('tracking_code', code)
        .maybeSingle();
      if (data) item = data;
    }
  }

  // Opción 3: si hay UN SOLO pendiente, asumir que es ese
  if (!item) {
    const { data: pendientes } = await supabase
      .from('script_queue')
      .select('*')
      .in('status', ['notified', 'in_progress'])
      .order('created_at', { ascending: false });
    if (pendientes && pendientes.length === 1) {
      item = pendientes[0];
    } else if (pendientes && pendientes.length > 1) {
      const lista = pendientes.map((p) => `• ${p.tracking_code} · ${(p.note ?? '').slice(0, 40)}`).join('\n');
      await ackReply(
        chatId,
        messageId,
        `⚠️ Tengo varios guiones pendientes y no sé a cuál asignar tu mensaje. Respondé <b>citando</b> el mensaje del guion, o arrancá tu mensaje con el código:\n\n${lista}`,
      );
      return new Response('ok', { status: 200 });
    }
  }

  if (!item) {
    await ackReply(chatId, messageId, '🤔 No encontré un guion pendiente para asociar este mensaje. Mandá <b>/pendientes</b> para ver la lista.');
    return new Response('ok', { status: 200 });
  }

  // Guardar respuesta
  await supabase
    .from('script_queue')
    .update({
      jipi_response: text,
      telegram_msg_id_in: messageId,
      status: 'completed',
    })
    .eq('id', item.id);

  await ackReply(
    chatId,
    messageId,
    `✅ Guion guardado en <b>${item.tracking_code}</b>. Lety ya lo puede ver en el CRM.`,
  );

  return new Response('ok', { status: 200 });
});
