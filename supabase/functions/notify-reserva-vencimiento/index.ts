// Detecta operations con fecha_vencimiento_reserva entre hoy y hoy+3 días
// (excluyendo escrituradas/canceladas) y manda push a Leti (admin) + al vendedor.
// Usa cooldown 24hs por operación para no spam.
//
// Llamado por pg_cron daily 9 AM (UTC-3 = 12 UTC).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface OpRow {
  id: string;
  property_id: string;
  vendedor_id: string;
  fecha_vencimiento_reserva: string;
  property_address?: string;
  propietario_nombre: string | null;
  precio_venta_usd: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';

  // 1. Buscar operations con vencimiento dentro de 0-3 días
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const in3Days = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: ops, error: opsErr } = await sb
    .from('operations')
    .select('id, property_id, vendedor_id, fecha_vencimiento_reserva, propietario_nombre, precio_venta_usd, property:properties(address)')
    .gte('fecha_vencimiento_reserva', todayISO)
    .lte('fecha_vencimiento_reserva', in3Days)
    .not('status', 'in', '("cancelada","escriturada")')
    .not('fecha_vencimiento_reserva', 'is', null);

  if (opsErr) {
    return new Response(JSON.stringify({ error: opsErr.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (!ops || ops.length === 0) {
    return new Response(JSON.stringify({ ok: true, found: 0, sent: 0, dry_run: dryRun }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // 2. Cooldown — no repetir misma alerta de la misma op dentro de 24hs
  const cutoff = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentEsc } = await sb
    .from('escalations')
    .select('contact_id, type, created_at')
    .gte('created_at', cutoff)
    .eq('type', 'reserva_vencimiento');
  const recentSet = new Set((recentEsc ?? []).map(r => r.contact_id));

  // 3. Get admin (Leti) y los vendedores que matchean
  const { data: leti } = await sb.from('agents').select('id').eq('role', 'admin').limit(1).single();

  let sent = 0;
  const skipped: string[] = [];
  const queued: Array<{ op_id: string; agent_ids: string[]; days_left: number }> = [];

  for (const opRaw of ops) {
    const op = opRaw as unknown as OpRow & { property?: { address: string } };
    if (recentSet.has(op.id)) {
      skipped.push(`${op.id} (cooldown)`);
      continue;
    }

    const ven = new Date(op.fecha_vencimiento_reserva);
    const daysLeft = Math.ceil((ven.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    const targetIds = [op.vendedor_id];
    if (leti?.id && leti.id !== op.vendedor_id) targetIds.push(leti.id);

    queued.push({ op_id: op.id, agent_ids: targetIds, days_left: daysLeft });

    if (dryRun) continue;

    // Push title/body
    const addr = op.property?.address ?? 'Propiedad';
    const dueño = op.propietario_nombre ? ` (${op.propietario_nombre})` : '';
    const title = daysLeft <= 0
      ? `⚠ Reserva vence HOY — ${addr}`
      : `⏳ Reserva vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'} — ${addr}`;
    const body = `Operación de USD ${Math.round(Number(op.precio_venta_usd) || 0).toLocaleString('es-AR')}${dueño}. Hablá con comprador/vendedor para extender o dar de baja.`;

    // 4. Mandar push usando edge function send-push
    for (const agentId of targetIds) {
      try {
        await sb.functions.invoke('send-push', {
          body: {
            agent_id: agentId,
            title,
            body,
            url: `/operations?id=${op.id}`,
          },
        });
      } catch (e) {
        console.error('send-push err', agentId, e);
      }
    }

    // 5. Registrar escalation para cooldown
    await sb.from('escalations').insert({
      contact_id: op.id,
      type: 'reserva_vencimiento',
      created_at: new Date().toISOString(),
    });

    sent += 1;
  }

  return new Response(JSON.stringify({
    ok: true,
    found: ops.length,
    sent,
    skipped,
    dry_run: dryRun,
    queued: dryRun ? queued : undefined,
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
