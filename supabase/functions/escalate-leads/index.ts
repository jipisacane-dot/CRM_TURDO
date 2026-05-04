// Cron-invoked: detects cold/unreplied leads and sends targeted push notifications.
// Admin role receives cross-team escalations; assigned vendor receives individual reminders.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const ADMIN_AGENT_ID = Deno.env.get('ADMIN_AGENT_ID') ?? 'leticia';

// Thresholds (hours)
const NO_REPLY_HOURS = 4;
const STALE_HOURS = 24;
const STALE_MAX_AGE_DAYS = 14; // don't escalate leads that haven't moved in ages
const ESCALATION_COOLDOWN_HOURS = 12; // don't re-escalate same type within this window
const MAX_NOTIFICATIONS_PER_RUN = 15; // prevent flooding on initial runs

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Contact {
  id: string;
  name: string | null;
  assigned_to: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  contact_id: string;
  direction: 'in' | 'out';
  created_at: string;
}

interface Escalation {
  contact_id: string;
  type: string;
  created_at: string;
}

async function sendPush(body: {
  title: string; body: string; contact_id?: string; url?: string; agent_id?: string;
}) {
  try {
    await supabase.functions.invoke('send-push', { body });
  } catch (e) {
    console.error('sendPush error:', e);
  }
}

async function recentlyEscalated(contactId: string, type: string): Promise<boolean> {
  const since = new Date(Date.now() - ESCALATION_COOLDOWN_HOURS * HOUR).toISOString();
  const { data, error } = await supabase
    .from('escalations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('type', type)
    .gte('created_at', since)
    .limit(1);
  if (error) { console.warn('escalations query failed (table missing?):', error.message); return false; }
  return !!data?.length;
}

async function logEscalation(contactId: string, type: string) {
  const { error } = await supabase.from('escalations').insert({ contact_id: contactId, type });
  if (error) console.warn('escalations insert failed:', error.message);
}

Deno.serve(async (req) => {
  const start = Date.now();
  const trigger = req.headers.get('x-cron-trigger') ?? 'manual';
  console.log(`escalate-leads triggered: ${trigger}`);

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_HOURS * HOUR).toISOString();
  const noReplyCutoff = new Date(now - NO_REPLY_HOURS * HOUR).toISOString();

  // 1) Load active contacts (excluding won/lost)
  const { data: contacts, error: contactsError } = await supabase
    .from('contacts')
    .select('id, name, assigned_to, status, created_at, updated_at')
    .not('status', 'in', '(won,lost)')
    .order('created_at', { ascending: true });

  if (contactsError) {
    console.error('Error fetching contacts:', contactsError);
    return new Response(JSON.stringify({ error: contactsError.message }), { status: 500 });
  }

  // 2) Load last message per contact (single query, dedup client-side)
  const contactIds = (contacts ?? []).map((c: Contact) => c.id);
  if (contactIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), { status: 200 });
  }

  const { data: messages } = await supabase
    .from('messages')
    .select('id, contact_id, direction, created_at')
    .in('contact_id', contactIds)
    .order('created_at', { ascending: false });

  const lastMsgByContact = new Map<string, Message>();
  const hasOutByContact = new Map<string, boolean>();
  for (const m of (messages ?? []) as Message[]) {
    if (!lastMsgByContact.has(m.contact_id)) lastMsgByContact.set(m.contact_id, m);
    if (m.direction === 'out') hasOutByContact.set(m.contact_id, true);
  }

  let noReplyCount = 0;
  let staleCount = 0;
  let skipped = 0;
  let notifications = 0;

  const staleMaxAgeCutoff = new Date(now - STALE_MAX_AGE_DAYS * DAY).toISOString();

  for (const c of (contacts ?? []) as Contact[]) {
    if (notifications >= MAX_NOTIFICATIONS_PER_RUN) { skipped++; continue; }

    const lastMsg = lastMsgByContact.get(c.id);
    const lastActivityIso = lastMsg?.created_at ?? c.created_at;
    const hasOut = hasOutByContact.get(c.id) ?? false;

    // ── No reply escalation ─────────────────────────────────────────────────
    if (c.assigned_to && !hasOut && c.created_at < noReplyCutoff) {
      if (await recentlyEscalated(c.id, 'no_reply')) { skipped++; }
      else {
        const hrs = Math.floor((now - new Date(c.created_at).getTime()) / HOUR);
        await sendPush({
          title: '⏰ Lead sin responder',
          body: `${c.name ?? 'Un lead'} lleva ${hrs}hs sin respuesta`,
          contact_id: c.id,
          url: '/inbox',
          agent_id: c.assigned_to,
        });
        // Also notify admin so Leticia sees it
        if (c.assigned_to !== ADMIN_AGENT_ID) {
          await sendPush({
            title: '⚠ Lead sin responder (equipo)',
            body: `${c.name ?? 'Un lead'} lleva ${hrs}hs sin respuesta del vendedor`,
            contact_id: c.id,
            url: '/inbox',
            agent_id: ADMIN_AGENT_ID,
          });
        }
        await logEscalation(c.id, 'no_reply');
        noReplyCount++;
        notifications++;
      }
    }

    // ── Stale escalation (last activity too old — but not ancient) ─────────
    if (lastActivityIso < staleCutoff && lastActivityIso > staleMaxAgeCutoff) {
      if (await recentlyEscalated(c.id, 'stale')) { skipped++; }
      else {
        const hrs = Math.floor((now - new Date(lastActivityIso).getTime()) / HOUR);
        // Notify assigned vendor if any, else admin
        const target = c.assigned_to ?? ADMIN_AGENT_ID;
        await sendPush({
          title: '❄ Lead enfriándose',
          body: `${c.name ?? 'Un lead'} sin actividad hace ${hrs}hs`,
          contact_id: c.id,
          url: '/inbox',
          agent_id: target,
        });
        // Admin always sees stale leads
        if (target !== ADMIN_AGENT_ID) {
          await sendPush({
            title: '❄ Lead frío (equipo)',
            body: `${c.name ?? 'Un lead'} sin actividad hace ${hrs}hs`,
            contact_id: c.id,
            url: '/inbox',
            agent_id: ADMIN_AGENT_ID,
          });
        }
        await logEscalation(c.id, 'stale');
        staleCount++;
        notifications++;
      }
    }
  }

  const result = {
    ok: true,
    duration_ms: Date.now() - start,
    trigger,
    processed: contacts?.length ?? 0,
    no_reply_notified: noReplyCount,
    stale_notified: staleCount,
    skipped_cooldown: skipped,
  };
  console.log('escalate-leads result:', result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
