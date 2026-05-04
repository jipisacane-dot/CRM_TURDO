// Edge function: revisa vencimientos próximos y manda push al admin.
// Cron: diario 9 AM ART.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface DBExpiration {
  id: string;
  type: string;
  title: string;
  description: string | null;
  due_date: string;
  notify_days_before: number;
  notified: boolean;
  resolved: boolean;
}

interface DBPushSub {
  id: string;
  agent_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function notifyAdmin(title: string, body: string) {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*, agent:agents!push_subscriptions_agent_id_fkey(role)')
    .returns<(DBPushSub & { agent: { role: string } | null })[]>();

  const adminSubs = (subs ?? []).filter(s => s.agent?.role === 'admin');
  if (adminSubs.length === 0) return;

  const SEND_PUSH_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`;
  const auth = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;

  await Promise.all(
    adminSubs.map(s =>
      fetch(SEND_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({
          subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          title,
          body,
          tag: 'expiration',
        }),
      }).catch(() => null)
    )
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const today = new Date();
    const todayISO = today.toISOString().slice(0, 10);

    const { data: expirations, error } = await supabase
      .from('expirations')
      .select('*')
      .eq('resolved', false)
      .eq('notified', false)
      .returns<DBExpiration[]>();

    if (error) throw error;

    const due: DBExpiration[] = [];
    for (const exp of expirations ?? []) {
      const dueDate = new Date(exp.due_date + 'T00:00:00');
      const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);
      if (daysUntil <= exp.notify_days_before) {
        due.push(exp);
      }
    }

    let notifiedCount = 0;
    for (const exp of due) {
      const dueDate = new Date(exp.due_date + 'T00:00:00');
      const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);
      const when = daysUntil <= 0
        ? `vence hoy`
        : daysUntil === 1
        ? `vence mañana`
        : `vence en ${daysUntil} días`;

      await notifyAdmin(
        `Vencimiento: ${exp.title}`,
        `${exp.description ?? exp.title} ${when}.`
      );

      await supabase
        .from('expirations')
        .update({ notified: true, notified_at: new Date().toISOString() })
        .eq('id', exp.id);

      notifiedCount++;
    }

    return new Response(JSON.stringify({ ok: true, scanned: expirations?.length ?? 0, notified: notifiedCount, today: todayISO }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: cors });
  }
});
