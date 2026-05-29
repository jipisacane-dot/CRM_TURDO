// Edge function: notify-unassigned-digest
// Cron-invoked 2x/día (ver cron schedule). Cuenta los leads NUEVOS sin asignar
// de las últimas 24hs y le manda a Leti un recordatorio por WhatsApp para que
// los derive al vendedor que corresponda.
//
// Por qué "últimas 24hs": al 29/05/2026 había ~1.500 contactos sin asignar que
// son backlog histórico (el CRM venía conectado a los canales antes de que el
// equipo lo empezara a usar). Contar solo los de las últimas 24hs deja afuera
// ese ruido y mantiene el digest siempre relevante.
//
// Canal: WhatsApp Cloud API template (plantilla `recordatorio_leads_sin_asignar`,
// aprobada por Meta). Si el SMB tier rechaza el envío directo con #200, hay que
// rutear el envío por ManyChat sendContent (ver project_turdo_whatsapp_flow).
//
// IMPORTANTE: requiere un token PERMANENTE con scope whatsapp_business_messaging
// (idealmente System User token, que no expira) en el secret WHATSAPP_SEND_TOKEN.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const WA_TOKEN = Deno.env.get('WHATSAPP_SEND_TOKEN')
  ?? Deno.env.get('WHATSAPP_TOKEN')
  ?? Deno.env.get('FB_PAGE_ACCESS_TOKEN')
  ?? '';
const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '216844138185123';
const LETI_PHONE = Deno.env.get('LETI_PERSONAL_PHONE') ?? ''; // formato E.164 sin '+', ej. 5492235252984
const TEMPLATE_NAME = 'recordatorio_leads_sin_asignar';
const TEMPLATE_LANG = 'es_AR';

const WINDOW_HOURS = 24;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async () => {
  // 1. Contar leads sin asignar creados en las últimas 24hs
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .is('assigned_to', null)
    .gte('created_at', since);

  if (error) {
    console.error('count error:', error);
    return json({ ok: false, error: error.message }, 500);
  }

  const n = count ?? 0;
  console.log(`[digest] ${n} leads sin asignar en las últimas ${WINDOW_HOURS}hs`);

  // 2. Si no hay nada pendiente, no molestamos a Leti
  if (n === 0) {
    return json({ ok: true, sent: false, reason: 'sin leads pendientes' });
  }

  // 3. Guards de configuración
  if (!LETI_PHONE) {
    return json({ ok: false, sent: false, error: 'LETI_PERSONAL_PHONE no configurado', count: n }, 400);
  }
  if (!WA_TOKEN) {
    return json({ ok: false, sent: false, error: 'token de WhatsApp no configurado', count: n }, 400);
  }

  // 4. Enviar plantilla por WhatsApp Cloud API
  const resp = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: LETI_PHONE,
      type: 'template',
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: String(n) }] },
        ],
      },
    }),
  });

  const result = await resp.json();
  if (!resp.ok) {
    console.error('[digest] envío falló:', JSON.stringify(result).slice(0, 400));
    // Si es #200 (SMB tier bloquea Cloud API directo), hay que migrar a ManyChat.
    return json({ ok: false, sent: false, count: n, wa_error: result?.error }, 502);
  }

  console.log(`[digest] enviado a Leti (${n} leads). wamid:`, result?.messages?.[0]?.id);
  return json({ ok: true, sent: true, count: n, result });
});
