// Edge function: ml-webhook
// Recibe notificaciones de Mercado Libre cuando subscribimos la app a topics.
//
// ML pushea un POST con shape:
//   {
//     "_id": "...",
//     "resource": "/items/MLA123" o "/orders/123" etc,
//     "user_id": 201023575,
//     "topic": "items" | "orders_v2" | "questions" | "messages" | "vis" | ...,
//     "application_id": 7965476289987236,
//     "attempts": 1,
//     "sent": "2026-05-27T15:00:00.000Z",
//     "received": "2026-05-27T15:00:00.000Z"
//   }
//
// Estrategia inicial: logueamos TODO en ml_notifications para descubrir qué
// topics realmente trae ML para nuestra cuenta. Después podemos rutear cada
// topic a un handler específico (questions → sync, messages → import, etc).
//
// IMPORTANTE: ML espera respuesta 200 en <10 segundos o reintenta. Por eso
// guardamos rápido y procesamos async después si hace falta.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  // GET = healthcheck o verificación manual
  if (req.method === 'GET') {
    return new Response(JSON.stringify({
      ok: true,
      message: 'ML webhook activo. Esperando notificaciones POST de Mercado Libre.',
      endpoint: 'https://dmwtyonwivujybvnopqq.supabase.co/functions/v1/ml-webhook',
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); }
  catch { /* may be empty body */ }

  // Loguear inmediatamente (sin procesar) para responder rápido a ML
  await sb.from('ml_notifications').insert({
    topic: body.topic ?? null,
    resource: body.resource ?? null,
    user_id: body.user_id ?? null,
    application_id: body.application_id ?? null,
    attempts: body.attempts ?? null,
    sent: body.sent ?? null,
    raw_payload: body,
    processed: false,
  });

  // ACK rápido (ML quiere <10s)
  return new Response('ok', { status: 200 });
});
