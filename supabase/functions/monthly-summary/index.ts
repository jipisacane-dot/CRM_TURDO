// Edge function: calcula resumen mensual y lo envía por WhatsApp al admin.
// Acepta { yearMonth?: 'YYYY-MM' } en el body. Default: mes anterior al actual.

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

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtARS = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

async function sendWhatsApp(phone: string, text: string) {
  if (!WA_PHONE_NUMBER_ID) return { ok: false, error: 'WHATSAPP_PHONE_NUMBER_ID not set' };
  const to = phone.replace(/\D/g, '');
  const resp = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
  const result = await resp.json();
  if (!resp.ok) return { ok: false, error: JSON.stringify(result) };
  return { ok: true };
}

interface DBOperation {
  id: string;
  precio_venta_usd: number;
  status: string;
  fecha_boleto: string;
  vendedor_id: string;
  captador_id: string | null;
}
interface DBCommission { agent_id: string; monto_usd: number; }
interface DBExpense { amount_ars: number; }
interface DBAgent { id: string; name: string; phone: string | null; role: string; }

function previousMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(ym: string): { start: string; end: string; label: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const label = new Date(y, m - 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return { start, end, label };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const yearMonth: string = body.yearMonth ?? previousMonth();
    const target: string | undefined = body.phone;
    const dryRun: boolean = body.dryRun === true;

    const { start, end, label } = monthRange(yearMonth);

    // Operaciones
    const { data: ops } = await supabase
      .from('operations')
      .select('*')
      .gte('fecha_boleto', start)
      .lte('fecha_boleto', end)
      .returns<DBOperation[]>();

    // Comisiones del mes (mes_liquidacion)
    const { data: comms } = await supabase
      .from('commissions')
      .select('agent_id, monto_usd')
      .gte('mes_liquidacion', start)
      .lte('mes_liquidacion', end)
      .eq('active', true)
      .returns<DBCommission[]>();

    // Gastos del mes
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount_ars')
      .gte('fecha', start)
      .lte('fecha', end)
      .returns<DBExpense[]>();

    // Agentes
    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, phone, role')
      .returns<DBAgent[]>();

    const opsActive = (ops ?? []).filter(o => o.status !== 'cancelada');
    const totalVolume = opsActive.reduce((s, o) => s + Number(o.precio_venta_usd), 0);
    const turdoComm = totalVolume * 0.03;
    const teamComm = totalVolume * 0.02;
    const totalCommissionsUsd = (comms ?? []).reduce((s, c) => s + Number(c.monto_usd), 0);
    const totalExpensesArs = (expenses ?? []).reduce((s, e) => s + Number(e.amount_ars), 0);

    // Top vendedor del mes
    const byAgent = new Map<string, number>();
    for (const c of comms ?? []) {
      byAgent.set(c.agent_id, (byAgent.get(c.agent_id) ?? 0) + Number(c.monto_usd));
    }
    const topAgents = Array.from(byAgent.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, amount]) => ({
        name: agents?.find(a => a.id === id)?.name ?? 'Vendedor',
        amount,
      }));

    // Componer mensaje
    const lines = [
      `📊 *Resumen Turdo · ${label}*`,
      ``,
      `🏠 *Operaciones*: ${opsActive.length} activas (${ops?.length ?? 0} totales)`,
      `💰 *Volumen vendido*: ${fmtUSD(totalVolume)}`,
      `🏢 *Comisión Turdo (3%)*: ${fmtUSD(turdoComm)}`,
      `👥 *Comisión equipo (2%)*: ${fmtUSD(teamComm)}`,
      `💵 *Comisiones a pagar*: ${fmtUSD(totalCommissionsUsd)}`,
      `📉 *Gastos del mes*: ${fmtARS(totalExpensesArs)}`,
      ``,
    ];
    if (topAgents.length > 0) {
      lines.push(`🏆 *Top vendedores*`);
      topAgents.forEach((a, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] ?? '·';
        lines.push(`${medal} ${a.name}: ${fmtUSD(a.amount)}`);
      });
    } else {
      lines.push(`Sin operaciones cerradas este mes.`);
    }
    lines.push(``, `Generado automáticamente por el CRM`);

    const message = lines.join('\n');

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, message, yearMonth }), { headers: cors });
    }

    // Destino
    let phone = target;
    if (!phone) {
      const admin = agents?.find(a => a.role === 'admin' && a.phone);
      phone = admin?.phone ?? undefined;
    }
    if (!phone) {
      return new Response(JSON.stringify({ ok: false, error: 'No phone configured for admin' }), { status: 400, headers: cors });
    }

    const result = await sendWhatsApp(phone, message);
    return new Response(JSON.stringify({ ok: result.ok, error: result.ok ? undefined : result.error, message, phone, yearMonth }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: cors });
  }
});
