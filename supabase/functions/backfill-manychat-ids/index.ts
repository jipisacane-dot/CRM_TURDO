// Backfill manychat_subscriber_id en los contactos del CRM.
// Para cada contacto sin subscriber_id pero con phone:
//   1. Busca el subscriber en ManyChat por nombre y matchea por whatsapp_phone.
//   2. Si no lo encuentra Y create_if_missing=true, lo crea via Phone Import API
//      (requiere que el feature esté activado en la cuenta de ManyChat — pedirlo
//      por mail a support@manychat.com con el justificativo de uso B2C con consent).
//
// Uso:
//   POST /functions/v1/backfill-manychat-ids
//   Body: {
//     dry_run?: boolean,             // default false — si true, no escribe nada
//     limit?: number,                // default 200
//     only_recent_days?: number,
//     create_if_missing?: boolean    // default false — si true, crea subscribers
//                                    //   en ManyChat para contactos no encontrados
//   }
//
// El proceso respeta el rate limit de ManyChat (~10 req/seg) con un delay
// entre requests.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MANYCHAT_KEY = Deno.env.get('MANYCHAT_API_KEY')!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface MCSubscriber {
  id: string;
  whatsapp_phone?: string | null;
  name?: string;
}

async function findByName(name: string): Promise<MCSubscriber[]> {
  try {
    const r = await fetch(
      `https://api.manychat.com/fb/subscriber/findByName?name=${encodeURIComponent(name)}`,
      { headers: { Authorization: `Bearer ${MANYCHAT_KEY}` } }
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (j.data ?? []) as MCSubscriber[];
  } catch {
    return [];
  }
}

// Busca un subscriber existente en ManyChat por número de WhatsApp.
// Retorna el subscriber_id si lo encuentra. Si ManyChat ya tiene ese phone
// bajo otro nombre, createSubscriber falla con "validation error" — esta
// función nos permite linkearlos antes de intentar crear.
async function findByWhatsappPhone(phoneE164: string): Promise<{ id?: string; raw?: string }> {
  try {
    const r = await fetch(
      `https://api.manychat.com/fb/subscriber/findByCustomField?field_id=__whatsapp_phone__&field_value=${encodeURIComponent(phoneE164)}`,
      { headers: { Authorization: `Bearer ${MANYCHAT_KEY}` } }
    );
    if (!r.ok) return {};
    const j = await r.json();
    const arr = (j?.data as Array<Record<string, unknown>> | undefined) ?? [];
    const match = arr.find(s => (s.whatsapp_phone as string | undefined) === phoneE164);
    if (match?.id) return { id: String(match.id) };
    return {};
  } catch {
    return {};
  }
}

// Crea un subscriber en ManyChat con el número de WhatsApp. Requiere feature
// "Phone Import" activado en la cuenta (ManyChat lo habilita por pedido).
// has_opt_in=true porque el consentimiento ya está documentado del lado del CRM
// (inbound WSP del cliente, Lead Form con checkbox, o walk-in con consent verbal).
async function createSubscriber(phoneE164: string, firstName: string, lastName: string): Promise<{ ok: boolean; id?: string; error?: string; rawResponse?: string }> {
  try {
    const body = {
      whatsapp_phone: phoneE164,
      first_name: firstName || 'Contacto',
      last_name: lastName || '-',
      has_opt_in_sms: false,
      has_opt_in_email: false,
      consent_phrase: 'Contact opted in via direct WhatsApp message, Meta Lead Ad form, or in-store consent.',
    };
    const r = await fetch('https://api.manychat.com/fb/subscriber/createSubscriber', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MANYCHAT_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const raw = await r.text();
    let j: Record<string, unknown>;
    try { j = JSON.parse(raw); } catch { j = { status: 'error', message: raw.slice(0, 300) }; }
    if (!r.ok || j?.status !== 'success') {
      return { ok: false, error: `HTTP ${r.status}: ${j?.message ?? 'unknown'}`, rawResponse: raw.slice(0, 500) };
    }
    const id = (j?.data as Record<string, unknown> | undefined)?.id;
    if (!id) return { ok: false, error: 'no id in response', rawResponse: raw.slice(0, 500) };
    return { ok: true, id: String(id) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function normalizePhone(p: string | null): string {
  if (!p) return '';
  return p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  if (!MANYCHAT_KEY) {
    return new Response(JSON.stringify({ error: 'MANYCHAT_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  let opts: { dry_run?: boolean; limit?: number; only_recent_days?: number; create_if_missing?: boolean; probe_phone?: string; stats?: boolean } = {};
  try { opts = await req.json(); } catch { /* opcional */ }

  // Modo STATS: contar cuántos contactos están linkeados y cuántos no
  if (opts.stats) {
    const { count: total } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('channel', 'whatsapp');
    const { count: linked } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('channel', 'whatsapp').not('manychat_subscriber_id', 'is', null);
    const { count: unlinked } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('channel', 'whatsapp').is('manychat_subscriber_id', null).not('phone', 'is', null);

    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { count: linkedLast7d } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('channel', 'whatsapp').not('manychat_subscriber_id', 'is', null).gte('updated_at', since);

    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count: linkedLast24h } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('channel', 'whatsapp').not('manychat_subscriber_id', 'is', null).gte('updated_at', since24h);

    // Últimos 5 linkeados
    const { data: recent } = await sb.from('contacts')
      .select('id, name, phone, manychat_subscriber_id, updated_at')
      .eq('channel', 'whatsapp')
      .not('manychat_subscriber_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(5);

    // Stats de delivery de mensajes salientes (últimos 7 días)
    const sinceDelivery = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: outMessages } = await sb.from('messages')
      .select('channel, delivery_status, created_at')
      .eq('direction', 'out')
      .gte('created_at', sinceDelivery)
      .limit(2000);

    const deliveryStats: Record<string, { total: number; sent: number; failed: number; pending: number }> = {};
    for (const m of outMessages ?? []) {
      const ch = (m.channel as string) || 'unknown';
      if (!deliveryStats[ch]) deliveryStats[ch] = { total: 0, sent: 0, failed: 0, pending: 0 };
      deliveryStats[ch].total++;
      if (m.delivery_status === 'sent') deliveryStats[ch].sent++;
      else if (m.delivery_status === 'failed') deliveryStats[ch].failed++;
      else deliveryStats[ch].pending++;
    }

    // Últimos 5 mensajes salientes con su status
    const { data: lastOut } = await sb.from('messages')
      .select('id, channel, delivery_status, delivery_error, created_at')
      .eq('direction', 'out')
      .order('created_at', { ascending: false })
      .limit(10);

    // IG stats
    const { count: igTotal } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('channel', 'instagram');
    const { count: igLinked } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('channel', 'instagram').not('manychat_subscriber_id', 'is', null);
    const { count: igLinkedLast7d } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('channel', 'instagram').not('manychat_subscriber_id', 'is', null).gte('updated_at', since);
    const { count: igLinkedLast24h } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('channel', 'instagram').not('manychat_subscriber_id', 'is', null).gte('updated_at', since24h);
    const { count: igUnlinked } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('channel', 'instagram').is('manychat_subscriber_id', null);

    const { data: igSamples } = await sb.from('contacts')
      .select('id, name, channel_id, manychat_subscriber_id, ig_psid, updated_at')
      .eq('channel', 'instagram')
      .not('manychat_subscriber_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(10);

    // Failed outbound IG: get full contact info
    const { data: failedIgMessages } = await sb.from('messages')
      .select('contact_id, delivery_error, created_at')
      .eq('direction', 'out')
      .eq('channel', 'instagram')
      .eq('delivery_status', 'failed')
      .order('created_at', { ascending: false })
      .limit(6);

    const failedIgContacts: Array<Record<string, unknown>> = [];
    for (const m of failedIgMessages ?? []) {
      const { data: c } = await sb.from('contacts').select('id, name, channel_id, manychat_subscriber_id, ig_psid, updated_at').eq('id', m.contact_id as string).single();
      if (c) failedIgContacts.push({ ...c, msg_at: m.created_at, msg_err: (m.delivery_error as string)?.slice(0, 120) });
    }

    return new Response(JSON.stringify({
      total_whatsapp_contacts: total,
      linked: linked,
      unlinked_with_phone: unlinked,
      linked_last_7d: linkedLast7d,
      linked_last_24h: linkedLast24h,
      most_recent_linked: recent,
      outbound_delivery_last_7d: deliveryStats,
      most_recent_outbound: lastOut,
      ig_total: igTotal,
      ig_linked: igLinked,
      ig_linked_last_7d: igLinkedLast7d,
      ig_linked_last_24h: igLinkedLast24h,
      ig_unlinked: igUnlinked,
      ig_samples: igSamples,
      failed_ig_contacts: failedIgContacts,
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Test send Cloud API directo para reproducir el error #200
  if ((opts as { test_cloud_api_send?: string }).test_cloud_api_send) {
    const toPhone = (opts as { test_cloud_api_send: string }).test_cloud_api_send;
    const waToken = Deno.env.get('WHATSAPP_TOKEN') ?? Deno.env.get('FB_PAGE_ACCESS_TOKEN');
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '216844138185123';

    const payload = {
      messaging_product: 'whatsapp',
      to: toPhone.replace(/\D/g, ''),
      type: 'text',
      text: { body: '[Diagnóstico CRM Turdo — ignorá este mensaje, es prueba técnica]' },
    };

    const resp = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${waToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const respText = await resp.text();
    return new Response(JSON.stringify({
      sent_to: toPhone,
      http_status: resp.status,
      response: respText,
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Diagnóstico del token de WhatsApp: chequear permisos y owner
  if ((opts as { check_wa_token?: boolean }).check_wa_token) {
    const waToken = Deno.env.get('WHATSAPP_TOKEN') ?? Deno.env.get('FB_PAGE_ACCESS_TOKEN');
    if (!waToken) {
      return new Response(JSON.stringify({ error: 'no WHATSAPP_TOKEN nor FB_PAGE_ACCESS_TOKEN env var' }), { status: 200 });
    }
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '216844138185123';

    // 1. Token owner info
    const meResp = await fetch(`https://graph.facebook.com/v22.0/me?access_token=${waToken}`);
    const meData = await meResp.json();

    // 2. Debug token (qué scopes tiene)
    const debugResp = await fetch(`https://graph.facebook.com/v22.0/debug_token?input_token=${waToken}&access_token=${waToken}`);
    const debugData = await debugResp.json();

    // 3. Phone number info accesible con este token
    const phoneResp = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}?access_token=${waToken}`);
    const phoneData = await phoneResp.json();

    return new Response(JSON.stringify({
      token_first_chars: waToken.slice(0, 30) + '...',
      me: meData,
      debug_token: debugData,
      phone_number_access: phoneData,
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Diagnóstico outbound: ver qué método usaron los últimos sends WhatsApp
  if ((opts as { check_wa_outbound?: boolean }).check_wa_outbound) {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data, error } = await sb.from('messages')
      .select('id, contact_id, meta_mid, delivery_status, delivery_error, created_at')
      .eq('direction', 'out')
      .eq('channel', 'whatsapp')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(60);

    // Para cada mensaje exitoso ver si el contact tenía manychat_subscriber_id
    const enriched = await Promise.all((data ?? []).map(async (m) => {
      const { data: c } = await sb.from('contacts').select('manychat_subscriber_id, phone').eq('id', m.contact_id as string).maybeSingle();
      // meta_mid puede tener prefijo según el método
      const mid = (m.meta_mid as string) || '';
      let probableMethod = 'unknown';
      if (mid.startsWith('wamid.')) probableMethod = 'cloud_api_direct';
      else if (mid.startsWith('mc_')) probableMethod = 'manychat';
      else if (!mid) probableMethod = c?.manychat_subscriber_id ? 'manychat_assumed' : 'cloud_api_assumed';
      return {
        delivery_status: m.delivery_status,
        delivery_error: (m.delivery_error as string)?.slice(0, 150),
        method: probableMethod,
        has_mc_id: !!c?.manychat_subscriber_id,
        created_at: m.created_at,
      };
    }));

    const summary: Record<string, number> = {};
    for (const e of enriched) {
      const k = `${e.method}/${e.delivery_status}`;
      summary[k] = (summary[k] ?? 0) + 1;
    }

    return new Response(JSON.stringify({ summary, total: enriched.length, recent_samples: enriched.slice(0, 15), error: error?.message }, null, 2), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Diagnóstico: qué webhook recibe los mensajes WhatsApp inbound recientes
  if ((opts as { check_wa_webhook_paths?: boolean }).check_wa_webhook_paths) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data, error } = await sb.from('messages')
      .select('id, contact_id, meta_mid, content, created_at')
      .eq('direction', 'in')
      .eq('channel', 'whatsapp')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20);
    const breakdown: Record<string, number> = { wamid: 0, mc_: 0, other: 0 };
    for (const m of data ?? []) {
      const mid = (m.meta_mid as string) || '';
      if (mid.startsWith('wamid.')) breakdown.wamid++;
      else if (mid.startsWith('mc_')) breakdown.mc_++;
      else breakdown.other++;
    }
    return new Response(JSON.stringify({
      breakdown,
      sample: (data ?? []).slice(0, 10).map(m => ({ meta_mid: m.meta_mid, created_at: m.created_at, content: ((m.content as string) || '').slice(0, 30) })),
      error: error?.message,
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Aplicar migration de expenses currency (one-shot)
  if ((opts as { apply_expenses_currency?: boolean }).apply_expenses_currency) {
    const sql = `
      DO $$ BEGIN
        ALTER TABLE expenses ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ARS';
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;

      DO $$ BEGIN
        ALTER TABLE expenses ADD CONSTRAINT expenses_currency_check CHECK (currency IN ('ARS','USD'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount_usd numeric(14,2);
      CREATE INDEX IF NOT EXISTS idx_expenses_currency ON expenses(currency) WHERE currency = 'USD';
    `;
    // Llamar rpc del service role
    const { error } = await sb.rpc('exec_sql', { sql });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, hint: 'exec_sql RPC puede no existir. Aplicar por dashboard' }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, applied: 'expenses_currency' }), { status: 200 });
  }

  // Listar operations recientes para identificar test rows
  if ((opts as { list_recent_ops?: boolean }).list_recent_ops) {
    const { data, error } = await sb.from('operations')
      .select('id, property_id, precio_venta_usd, status, approval_status, rejected_reason, propietario_nombre, honorarios_totales_usd, honorarios_vendedor_usd, honorarios_captador_usd, created_at, notes, observaciones_extra')
      .order('created_at', { ascending: false })
      .limit(20);
    return new Response(JSON.stringify({ data, error: error?.message }, null, 2), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Borrar test row de operations
  if ((opts as { delete_op_id?: string }).delete_op_id) {
    const id = (opts as { delete_op_id: string }).delete_op_id;
    const { error } = await sb.from('operations').delete().eq('id', id);
    return new Response(JSON.stringify({ deleted: id, error: error?.message }), { status: 200 });
  }

  // Reproducir bug operation insert
  if ((opts as { repro_operation?: boolean }).repro_operation) {
    // Buscar 1 property y 1 agent reales
    const { data: prop } = await sb.from('properties').select('id').limit(1).single();
    const { data: agent } = await sb.from('agents').select('id').eq('role', 'agent').limit(1).single();
    const { data: admin } = await sb.from('agents').select('id').eq('role', 'admin').limit(1).single();
    if (!prop || !agent) {
      return new Response(JSON.stringify({ error: 'no prop or agent for repro' }), { status: 200 });
    }

    const today = new Date().toISOString().slice(0, 10);
    // Réplica exacta del payload que el frontend envía (Operations.tsx:350)
    const payload = {
      property_id: prop.id,
      captador_id: agent.id,
      vendedor_id: agent.id,
      precio_venta_usd: 88600,
      fecha_boleto: today,
      fecha_escritura: null,
      fecha_reserva: today,
      fecha_vencimiento_reserva: null,
      monto_sena_usd: null,
      contact_id: null,
      status: 'reservada',
      cancelled_at: null,
      cancelled_reason: null,
      approval_status: 'approved',
      approved_by: admin?.id ?? null,
      approved_at: null,
      rejected_reason: null,
      paid_at: null,
      agency_commission_pct: 6,
      propietario_nombre: 'Pablo (test repro)',
      propietario_telefono: null,
      is_compartida: false,
      inmobiliaria_compartida_nombre: null,
      comision_pct_turdo: 6,
      comision_captador_pct: 50,
      honorarios_totales_usd: null,
      honorarios_vendedor_usd: null,
      honorarios_captador_usd: null,
      escribania_nombre: null,
      monto_escrituracion_usd: null,
      gastos_escribania_comprador_usd: null,
      gastos_escribania_vendedor_usd: null,
      tasador: null,
      cedula_estado: null,
      osse: null,
      arba: null,
      arm: null,
      camuzzi: null,
      edea: null,
      administracion: null,
      notes: null,
      observaciones_extra: null,
    };

    const { data, error } = await sb.from('operations').insert(payload).select().single();
    return new Response(JSON.stringify({
      payload_sent: payload,
      result_data: data,
      result_error: error,
      hint: data ? 'INSERTED — borrarlo manualmente. id arriba' : 'ERROR capturado',
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Diagnóstico schema de operations
  if ((opts as { check_operations_schema?: boolean }).check_operations_schema) {
    const { data, error } = await sb.from('operations').select('*').limit(1);
    if (error) {
      return new Response(JSON.stringify({ error: error.message, hint: 'failed select' }, null, 2), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!data || data.length === 0) {
      // Sin filas — intentar insert vacío para forzar error con nombres de columnas
      const { error: insErr } = await sb.from('operations').insert({} as Record<string, unknown>).select().single();
      return new Response(JSON.stringify({
        empty_table: true,
        insert_empty_error: insErr?.message ?? 'no error',
        hint: 'la tabla está vacía, no podemos listar columnas via API',
      }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      columns: Object.keys(data[0] as Record<string, unknown>),
      sample: data[0],
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Probe específico: pasar subscriber_id y consultar getInfo en ManyChat
  if ((opts as { probe_subscriber_id?: string }).probe_subscriber_id) {
    const subId = (opts as { probe_subscriber_id: string }).probe_subscriber_id;
    const r = await fetch(`https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${subId}`, {
      headers: { Authorization: `Bearer ${MANYCHAT_KEY}` }
    });
    const raw = await r.text();
    return new Response(JSON.stringify({ subscriber_id: subId, status: r.status, body: raw.slice(0, 1500) }, null, 2), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Modo PROBE: testear distintos endpoints de ManyChat para encontrar el bueno
  // que permita lookup de subscriber por wa_id / phone.
  if (opts.probe_phone) {
    const phone = opts.probe_phone;
    const waId = phone.replace(/^\+/, '');
    const results: Record<string, unknown> = {};

    const probes: Array<[string, string]> = [
      ['findBySystemField_phone_param',     `https://api.manychat.com/fb/subscriber/findBySystemField?phone=${encodeURIComponent(phone)}`],
      ['findBySystemField_phone_no_plus',   `https://api.manychat.com/fb/subscriber/findBySystemField?phone=${encodeURIComponent(waId)}`],
      ['findByCustomField_phone',           `https://api.manychat.com/fb/subscriber/findByCustomField?phone=${encodeURIComponent(phone)}`],
      ['getInfoByCustomField_phone',        `https://api.manychat.com/fb/subscriber/getInfoByCustomField?phone=${encodeURIComponent(phone)}`],
      ['hasOptIn',                          `https://api.manychat.com/fb/subscriber/hasOptIn?phone=${encodeURIComponent(phone)}`],
    ];

    for (const [label, url] of probes) {
      try {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${MANYCHAT_KEY}` } });
        const raw = await r.text();
        results[label] = { status: r.status, body: raw.slice(0, 400) };
      } catch (e) {
        results[label] = { error: String(e) };
      }
      await new Promise(r => setTimeout(r, 200));
    }

    return new Response(JSON.stringify({ probe_phone: phone, wa_id: waId, results }, null, 2), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const dryRun = opts.dry_run ?? false;
  const limit = opts.limit ?? 200;
  const createIfMissing = opts.create_if_missing ?? false;

  // Traer contactos sin subscriber_id, con teléfono, y con nombre que NO sea
  // genérico (sin "Sin nombre", sin solo dígitos). Esos son los únicos que
  // podemos matchear con findByName de ManyChat.
  let q = sb.from('contacts')
    .select('id, name, phone, phone_normalized')
    .is('manychat_subscriber_id', null)
    .not('phone', 'is', null)
    .not('name', 'in', '("Sin nombre","Sin Nombre","sin nombre")')
    .not('name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts.only_recent_days) {
    const cutoff = new Date(Date.now() - opts.only_recent_days * 86400_000).toISOString();
    q = q.gte('updated_at', cutoff);
  }

  const { data: contacts, error: qErr } = await q;
  if (qErr) {
    return new Response(JSON.stringify({ error: qErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`[backfill] processing ${contacts?.length ?? 0} contacts (dry_run=${dryRun}, create_if_missing=${createIfMissing})`);

  let matched = 0, created = 0, skipped = 0, errors = 0;
  const samples: Array<{ crm_id: string; name: string; phone: string; mc_id?: string; action: 'matched' | 'created' | 'skipped' | 'error'; error?: string }> = [];

  for (const c of contacts ?? []) {
    const phoneNorm = normalizePhone(c.phone as string | null);
    if (!phoneNorm || phoneNorm.length < 8) { skipped++; continue; }

    const name = (c.name as string) ?? '';
    if (!name || name === 'Sin nombre' || /^\+?\d+$/.test(name)) {
      // Sin nombre útil → no podemos buscar por nombre. Saltamos.
      skipped++;
      continue;
    }

    try {
      const results = await findByName(name);
      const match = results.find(s => s.whatsapp_phone === phoneNorm);
      if (match?.id) {
        if (!dryRun) {
          const { error: updErr } = await sb.from('contacts')
            .update({ manychat_subscriber_id: String(match.id) })
            .eq('id', c.id);
          if (updErr) { errors++; continue; }
        }
        matched++;
        if (samples.length < 10) {
          samples.push({ crm_id: c.id as string, name, phone: phoneNorm, mc_id: String(match.id), action: 'matched' });
        }
      } else if (createIfMissing) {
        // Antes de crear, intentar lookup por phone (puede existir en ManyChat
        // con otro nombre — caso típico de subscribers que migraron de canal).
        const byPhone = await findByWhatsappPhone(phoneNorm);
        if (byPhone.id) {
          if (!dryRun) {
            const { error: updErr } = await sb.from('contacts')
              .update({ manychat_subscriber_id: byPhone.id })
              .eq('id', c.id);
            if (updErr) { errors++; continue; }
          }
          matched++;
          if (samples.length < 10) {
            samples.push({ crm_id: c.id as string, name, phone: phoneNorm, mc_id: byPhone.id, action: 'matched' });
          }
          await new Promise(r => setTimeout(r, 120));
          continue;
        }

        // No existe en ManyChat: crear con Phone Import API
        if (dryRun) {
          created++;
          if (samples.length < 10) {
            samples.push({ crm_id: c.id as string, name, phone: phoneNorm, action: 'created' });
          }
        } else {
          const { first, last } = splitName(name);
          const r = await createSubscriber(phoneNorm, first, last);
          if (r.ok && r.id) {
            const { error: updErr } = await sb.from('contacts')
              .update({ manychat_subscriber_id: r.id })
              .eq('id', c.id);
            if (updErr) { errors++; continue; }
            created++;
            if (samples.length < 10) {
              samples.push({ crm_id: c.id as string, name, phone: phoneNorm, mc_id: r.id, action: 'created' });
            }
          } else {
            errors++;
            if (samples.length < 10) {
              samples.push({ crm_id: c.id as string, name, phone: phoneNorm, action: 'error', error: `${r.error} | raw: ${r.rawResponse ?? ''}` });
            }
            console.error('[backfill] createSubscriber failed for', c.id, r.error, r.rawResponse);
          }
          // Extra delay para createSubscriber (operación de escritura)
          await new Promise(r => setTimeout(r, 200));
        }
      } else {
        skipped++;
        if (samples.length < 10) {
          samples.push({ crm_id: c.id as string, name, phone: phoneNorm, action: 'skipped' });
        }
      }
    } catch (e) {
      console.error('[backfill] err on', c.id, e);
      errors++;
    }

    // Rate limit: ~10 req/seg => 120ms entre requests
    await new Promise(r => setTimeout(r, 120));
  }

  return new Response(JSON.stringify({
    ok: true,
    total_processed: contacts?.length ?? 0,
    matched,
    created,
    skipped,
    errors,
    dry_run: dryRun,
    create_if_missing: createIfMissing,
    samples,
  }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
