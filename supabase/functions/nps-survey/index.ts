// Edge function: detecta operaciones escrituradas hace X días sin NPS enviado
// y manda encuesta NPS por WhatsApp al contacto comprador.
// Cron: diario 10 AM ART.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FB_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN')!;
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? FB_TOKEN;
const WA_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface NpsRow {
  id: string;
  operation_id: string;
  contact_id: string | null;
  send_at: string;
  sent: boolean;
}

async function sendWhatsApp(phone: string, text: string) {
  if (!WA_PHONE_NUMBER_ID) return { ok: false, error: 'WHATSAPP_PHONE_NUMBER_ID not set' };
  const to = phone.replace(/\D/g, '');
  const resp = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
  const result = await resp.json();
  return { ok: resp.ok, error: resp.ok ? undefined : JSON.stringify(result) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const today = new Date().toISOString().slice(0, 10);

    const { data: pending, error } = await supabase
      .from('nps_surveys')
      .select('*')
      .eq('sent', false)
      .lte('send_at', today)
      .returns<NpsRow[]>();
    if (error) throw error;

    let sentCount = 0;
    let skipped = 0;

    for (const row of pending ?? []) {
      // Buscar el contacto para teléfono y nombre
      if (!row.contact_id) {
        skipped++;
        continue;
      }
      const { data: contact } = await supabase
        .from('contacts')
        .select('name, phone')
        .eq('id', row.contact_id)
        .maybeSingle();

      if (!contact?.phone) {
        skipped++;
        continue;
      }

      const message = [
        `Hola ${contact.name ?? ''} 👋`,
        ``,
        `Soy del equipo de *Turdo Estudio Inmobiliario*. Hace un mes acompañamos tu operación y queremos saber cómo te fue.`,
        ``,
        `Del 0 al 10, ¿qué tan probable es que nos recomiendes a un amigo o familiar?`,
        ``,
        `Respondé este mensaje con un número y, si querés, contanos brevemente por qué. ¡Gracias!`,
      ].join('\n');

      const result = await sendWhatsApp(contact.phone, message);
      if (result.ok) {
        await supabase.from('nps_surveys').update({
          sent: true,
          sent_at: new Date().toISOString(),
          channel: 'whatsapp',
        }).eq('id', row.id);
        sentCount++;
      } else {
        skipped++;
      }
    }

    return new Response(JSON.stringify({ ok: true, scanned: pending?.length ?? 0, sent: sentCount, skipped }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: cors });
  }
});
