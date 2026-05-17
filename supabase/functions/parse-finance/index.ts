// Edge fn: parse-finance
// Toma texto natural ("salí a comer con Juan $50.000") y devuelve
// el movimiento estructurado: { type, category, amount, currency, description }
// Usa Claude Haiku (fast + cheap, no necesitamos Sonnet para esto).

import { requireAuth } from '../_shared/auth.ts';
import { rateLimit } from '../_shared/rate_limit.ts';
import { buildCors } from '../_shared/cors.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL = 'claude-haiku-4-5-20251001';

const PERSONAL_CATEGORIES = [
  'comida', 'transporte', 'casa', 'servicios', 'salud',
  'ocio', 'ropa', 'viajes', 'cuidado_personal', 'regalos', 'otros'
];

const BRANCH_CATEGORIES = [
  'alquiler', 'servicios', 'sueldos', 'comisiones', 'marketing',
  'mantenimiento', 'papeleria', 'software', 'impuestos',
  'ventas', 'reservas', 'tasaciones', 'otros'
];

interface ParseResult {
  ok: boolean;
  type?: 'income' | 'expense';
  category?: string;
  amount?: number;
  currency?: 'ARS' | 'USD';
  description?: string;
  movement_date?: string;
  error?: string;
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (!cors) return new Response('Forbidden origin', { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const authError = await requireAuth(req, cors);
  if (authError) return authError;

  const rl = await rateLimit(req, 'parse-finance', 30, 60, cors);
  if (rl) return rl;

  let body: { text?: string; scope?: 'personal' | 'branch' };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }); }

  const text = (body.text ?? '').trim();
  const scope = body.scope ?? 'personal';
  if (!text) {
    return new Response(JSON.stringify({ error: 'Falta el texto' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (text.length > 500) {
    return new Response(JSON.stringify({ error: 'Texto demasiado largo (max 500)' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const categories = scope === 'personal' ? PERSONAL_CATEGORIES : BRANCH_CATEGORIES;
  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt = `Sos un parser de finanzas para un CRM inmobiliario argentino (Mar del Plata).
Tu trabajo es tomar texto coloquial en español argentino y extraer el movimiento financiero estructurado.

Contexto:
- scope=${scope} (${scope === 'personal' ? 'gastos personales de la dueña' : 'movimientos de un local inmobiliario'})
- categorías válidas: ${categories.join(', ')}
- hoy es ${today}
- moneda default: ARS (Argentina). Solo USD si dice explícitamente "dólares", "USD", "u$s", "verdes"
- "k" = mil. "10k" = 10000. "1.5M" = 1500000.
- "$" o "pesos" o sin símbolo + número grande = ARS

Reglas de categorización:
${scope === 'personal' ? `
- comida: restaurante, delivery, supermercado, café
- transporte: nafta, uber, taxi, peaje, colectivo, estacionamiento
- casa: alquiler, expensas, muebles, decoración, reparaciones del hogar
- servicios: luz, gas, agua, internet, celular, cable
- salud: farmacia, médico, obra social, terapia
- ocio: cine, salida, recital, deporte, hobbies
- ropa: indumentaria, calzado, accesorios
- viajes: vacaciones, hoteles, vuelos
- cuidado_personal: peluquería, manicura, gimnasio, cosmética
- regalos: cumpleaños, navidad, casamientos
- otros: si no encaja en ninguna
` : `
- alquiler: alquiler del local, ABL
- servicios: luz, gas, internet del local
- sueldos: pago a vendedores (no comisiones)
- comisiones: comisiones pagadas a vendedores por ventas
- marketing: Meta Ads, Google, cartelería, branding
- mantenimiento: limpieza, arreglos, ferretería
- papeleria: insumos oficina, impresiones, librería
- software: suscripciones SaaS, hosting, dominios
- impuestos: AFIP, IIBB, monotributo, ARBA
- ventas: ingreso por venta de propiedad
- reservas: ingreso por seña/reserva
- tasaciones: cobro por tasación
- otros: si no encaja en ninguna
`}

Salida ESTRICTA JSON con esta forma:
{
  "ok": true,
  "type": "income" | "expense",
  "category": "<una de las válidas>",
  "amount": <número positivo>,
  "currency": "ARS" | "USD",
  "description": "<descripción concisa de 3-8 palabras>",
  "movement_date": "<YYYY-MM-DD, por defecto hoy>"
}

Si no podés parsear (texto ambiguo, sin monto, etc):
{ "ok": false, "error": "<razón corta>" }

Devolvé SOLO el JSON, sin explicación previa ni markdown.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!resp.ok) {
      console.error('[parse-finance] anthropic error:', resp.status, await resp.text());
      return new Response(JSON.stringify({ ok: false, error: 'AI service error' }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const data = await resp.json();
    const rawContent = data?.content?.[0]?.text ?? '';
    let parsed: ParseResult;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'No pude entender el texto, intentá reformularlo' }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Validar la respuesta
    if (!parsed.ok) {
      return new Response(JSON.stringify(parsed),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (!['income', 'expense'].includes(parsed.type ?? '')) parsed.type = 'expense';
    if (!categories.includes(parsed.category ?? '')) parsed.category = 'otros';
    if (typeof parsed.amount !== 'number' || parsed.amount <= 0) {
      return new Response(JSON.stringify({ ok: false, error: 'No detecté un monto válido' }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (!['ARS', 'USD'].includes(parsed.currency ?? '')) parsed.currency = 'ARS';
    if (!parsed.movement_date) parsed.movement_date = today;

    return new Response(JSON.stringify(parsed),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[parse-finance] err:', e);
    return new Response(JSON.stringify({ ok: false, error: 'Error procesando el texto' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
