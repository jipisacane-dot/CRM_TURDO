// Cron-invoked: lee notification_rules con enabled=true y dispara los pushes correspondientes.
// Una sola función para todas las reglas — mantenible y configurable desde el admin.
// Cooldown trackeado en escalations(contact_id, type, created_at).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const ADMIN_AGENT_ID = Deno.env.get('ADMIN_AGENT_ID') ?? 'leticia';
const MAX_PUSHES_PER_RUN = 30;

// Dry-run: cuando viene `?dry_run=1` o body { dry_run: true }, solo loguea sin mandar push ni insertar escalation.
let DRY_RUN = false;

interface Rule {
  rule_key: string;
  name: string;
  enabled: boolean;
  threshold_minutes: number | null;
  cooldown_hours: number;
  notify_assigned_agent: boolean;
  notify_admin: boolean;
  push_title: string;
  push_body: string;
  applies_to_stages: string[];
  config: Record<string, unknown>;
}

interface ContactCtx {
  id: string;
  name: string | null;
  assigned_to: string | null;
  current_stage_key: string | null;
  stage_changed_at: string | null;
  created_at: string;
  updated_at: string | null;
}

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;

function fillTemplate(tpl: string, ctx: ContactCtx, extra: Record<string, string | number>): string {
  return tpl
    .replaceAll('{contact_name}', ctx.name ?? 'Lead')
    .replaceAll('{stage}', ctx.current_stage_key ?? 'nuevo')
    .replaceAll('{hours}', String(extra.hours ?? ''))
    .replaceAll('{minutes}', String(extra.minutes ?? ''))
    .replaceAll('{days}', String(extra.days ?? ''));
}

async function recentlyEscalated(contactId: string, type: string, cooldownHours: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - cooldownHours * HOUR).toISOString();
  const { data } = await supabase
    .from('escalations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('type', type)
    .gte('created_at', cutoff)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function sendPush(args: {
  rule: Rule;
  contact: ContactCtx;
  extra: Record<string, string | number>;
  log: string[];
  count: { sent: number };
}): Promise<boolean> {
  const { rule, contact, extra, log, count } = args;

  if (count.sent >= MAX_PUSHES_PER_RUN) {
    log.push(`SKIP ${rule.rule_key} ${contact.id}: max pushes reached`);
    return false;
  }

  if (await recentlyEscalated(contact.id, rule.rule_key, rule.cooldown_hours)) {
    log.push(`SKIP ${rule.rule_key} ${contact.id}: in cooldown`);
    return false;
  }

  const title = fillTemplate(rule.push_title, contact, extra);
  const body = fillTemplate(rule.push_body, contact, extra);

  const targets: string[] = [];
  if (rule.notify_assigned_agent && contact.assigned_to) targets.push(contact.assigned_to);
  if (rule.notify_admin && !targets.includes(ADMIN_AGENT_ID)) targets.push(ADMIN_AGENT_ID);

  if (targets.length === 0) {
    log.push(`SKIP ${rule.rule_key} ${contact.id}: no targets (assigned_to=null + notify_admin=false)`);
    return false;
  }

  if (DRY_RUN) {
    log.push(`DRY ${rule.rule_key} → ${targets.join(',')} | ${contact.name} (${contact.id}) | "${title}: ${body}"`);
    count.sent += 1;
    return true;
  }

  for (const agentId of targets) {
    await supabase.functions.invoke('send-push', {
      body: { title, body, contact_id: contact.id, url: '/inbox', agent_id: agentId },
    }).catch(e => log.push(`PUSH ERR ${rule.rule_key} ${agentId}: ${e}`));
  }

  await supabase.from('escalations').insert({ contact_id: contact.id, type: rule.rule_key });
  count.sent += 1;
  log.push(`SENT ${rule.rule_key} → ${targets.join(',')} | ${contact.name} (${contact.id})`);
  return true;
}

// ── Reglas individuales ─────────────────────────────────────────────────────

async function ruleAgentNoReply(rule: Rule, log: string[], count: { sent: number }) {
  // Mensajes IN sin respuesta del vendedor en X minutos.
  // Buscamos el último mensaje IN por contacto con created_at >= now - threshold_minutes
  // y que NO tenga ningún mensaje OUT posterior.
  if (!rule.threshold_minutes) return;
  const cutoff = new Date(Date.now() - rule.threshold_minutes * MINUTE).toISOString();

  // Tomamos contactos asignados con etapa válida y último mensaje IN antes del cutoff
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, assigned_to, current_stage_key, stage_changed_at, created_at, updated_at')
    .in('current_stage_key', rule.applies_to_stages)
    .not('assigned_to', 'is', null)
    .limit(200);

  if (!contacts) return;

  for (const c of contacts as ContactCtx[]) {
    // Último mensaje del contacto
    const { data: lastMsgs } = await supabase
      .from('messages')
      .select('direction, created_at')
      .eq('contact_id', c.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const last = lastMsgs?.[0];
    if (!last) continue;
    if (last.direction !== 'in') continue;             // último ya es del vendedor
    if (last.created_at > cutoff) continue;            // todavía no llegó al threshold
    // Si pasaron muchas más horas que el threshold + cooldown, lo ignoramos (otra regla más fuerte ya disparó)
    const ageMin = Math.floor((Date.now() - new Date(last.created_at).getTime()) / MINUTE);
    if (ageMin > rule.threshold_minutes * 4 + rule.cooldown_hours * 60) continue;

    await sendPush({
      rule,
      contact: c,
      extra: { minutes: ageMin, hours: Math.floor(ageMin / 60) },
      log,
      count,
    });
  }
}

async function ruleCold24h(rule: Rule, log: string[], count: { sent: number }) {
  // Solo leads ASIGNADOS y RECIENTES: si nadie del equipo se está ocupando, no es "frío del vendedor".
  // Filtro temporal usa stage_changed_at (no created_at) — un lead movido ayer está activo aunque
  // se haya creado hace 6 meses.
  if (!rule.threshold_minutes) return;
  const maxAgeDays = (rule.config?.max_age_days as number) ?? 14;
  const cutoffActivity = new Date(Date.now() - rule.threshold_minutes * MINUTE).toISOString();
  const cutoffStaleStage = new Date(Date.now() - maxAgeDays * DAY).toISOString();

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, assigned_to, current_stage_key, stage_changed_at, created_at, updated_at')
    .in('current_stage_key', rule.applies_to_stages)
    .not('assigned_to', 'is', null)
    .gte('stage_changed_at', cutoffStaleStage)
    .lt('updated_at', cutoffActivity)
    .limit(200);

  if (!contacts) return;

  for (const c of contacts as ContactCtx[]) {
    const last = c.updated_at ?? c.created_at;
    const hours = Math.floor((Date.now() - new Date(last).getTime()) / HOUR);
    await sendPush({ rule, contact: c, extra: { hours }, log, count });
  }
}

async function rulePausedFollowup(rule: Rule, log: string[], count: { sent: number }) {
  const followupDays = (rule.config?.followup_days as number) ?? 7;
  const cutoff = new Date(Date.now() - followupDays * DAY).toISOString();

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, assigned_to, current_stage_key, stage_changed_at, created_at, updated_at')
    .in('current_stage_key', rule.applies_to_stages)
    .lt('stage_changed_at', cutoff)
    .not('assigned_to', 'is', null)
    .limit(200);

  if (!contacts) return;

  for (const c of contacts as ContactCtx[]) {
    const days = Math.floor((Date.now() - new Date(c.stage_changed_at ?? c.created_at).getTime()) / DAY);
    await sendPush({ rule, contact: c, extra: { days, hours: days * 24 }, log, count });
  }
}

async function ruleVisitReminder(rule: Rule, log: string[], count: { sent: number }) {
  if (!rule.threshold_minutes) return;
  const now = new Date();
  const upper = new Date(now.getTime() + rule.threshold_minutes * MINUTE).toISOString();
  const lower = now.toISOString();

  const { data: reminders } = await supabase
    .from('reminders')
    .select('id, contact_id, title, due_at, agent_id, done')
    .eq('done', false)
    .gte('due_at', lower)
    .lt('due_at', upper)
    .limit(50);

  if (!reminders) return;

  for (const r of reminders) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, name, assigned_to, current_stage_key, stage_changed_at, created_at, updated_at')
      .eq('id', r.contact_id)
      .single();
    if (!contact) continue;
    if (rule.applies_to_stages.length > 0 && !rule.applies_to_stages.includes(contact.current_stage_key ?? '')) continue;

    const minutes = Math.floor((new Date(r.due_at).getTime() - Date.now()) / MINUTE);
    await sendPush({
      rule,
      contact: { ...contact, assigned_to: contact.assigned_to ?? r.agent_id },
      extra: { minutes, hours: Math.floor(minutes / 60) },
      log,
      count,
    });
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const log: string[] = [];
  const count = { sent: 0 };

  // dry_run via query string ?dry_run=1 o body { dry_run: true }
  const url = new URL(req.url);
  DRY_RUN = url.searchParams.get('dry_run') === '1';
  if (!DRY_RUN && req.method === 'POST') {
    try {
      const body = await req.json().catch(() => ({}));
      DRY_RUN = body?.dry_run === true;
    } catch { /* ignore */ }
  }

  const { data: rules, error } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('enabled', true);

  if (error || !rules) {
    return new Response(JSON.stringify({ error: error?.message ?? 'no rules' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  for (const rule of rules as Rule[]) {
    try {
      switch (rule.rule_key) {
        case 'agent_no_reply_15min':
        case 'agent_no_reply_4h':
          await ruleAgentNoReply(rule, log, count);
          break;
        case 'cold_24h':
          await ruleCold24h(rule, log, count);
          break;
        case 'paused_followup':
          await rulePausedFollowup(rule, log, count);
          break;
        case 'visit_reminder_1h':
          await ruleVisitReminder(rule, log, count);
          break;
        default:
          log.push(`SKIP ${rule.rule_key}: unknown rule_key`);
      }
    } catch (e) {
      log.push(`ERR ${rule.rule_key}: ${e}`);
    }
  }

  console.log(log.join('\n'));
  return new Response(JSON.stringify({ ok: true, sent: count.sent, log }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
