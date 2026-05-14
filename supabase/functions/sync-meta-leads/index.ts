// Edge function: sync-meta-leads
// Lee los Lead Forms registrados en meta_form_sync, baja los leads nuevos
// de Meta Graph y los inserta como contacts en el CRM.
//
// Dedup:
//   1. Por phone normalizado (solo dígitos) o email lowercase contra contacts existentes.
//   2. Si encuentra match → skip (no actualiza para no pisar datos manuales).
//
// Asignación:
//   - assigned_to = null. Leti distribuye desde /contacts.
//
// Trigger:
//   - Manual: POST a la edge fn desde el CRM (UI futura) o via curl.
//   - Cron: pg_cron job cada 30min llama a esta fn vía pg_net.
//
// Categorización (matching memoria de Lety, 2026-05-13):
//   - vendedores → channel 'facebook' + status 'new' + branch default
//   - compradores_general → channel 'facebook' + branch default
//   - project_specific → channel 'facebook' + property_title = project_name + branch default

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FB_PAGE_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN')!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const ALLOWED_ORIGINS = [
  'https://crm-turdo.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];
const isPreviewVercel = (o: string) =>
  /^https:\/\/crm-turdo-[a-z0-9]+-jipisacane-5891s-projects\.vercel\.app$/.test(o);

function buildCors(req: Request): Record<string, string> | null {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || isPreviewVercel(origin) || origin === '';
  if (!allowed) return null;
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
}

interface FormConfig {
  form_id: string;
  label: string;
  category: 'vendedores' | 'compradores_general' | 'project_specific';
  project_name: string | null;
  default_branch: string;
  last_synced_at: string | null;
  last_lead_id: string | null;
  total_synced: number;
}

interface MetaLead {
  id: string;
  created_time: string;
  field_data: { name: string; values: string[] }[];
}

function normalizePhone(p: string): string {
  return (p || '').replace(/\D/g, '');
}

async function fetchLeadsForForm(formId: string, since: string | null): Promise<MetaLead[]> {
  const params = new URLSearchParams({
    fields: 'created_time,field_data',
    limit: '100',
    access_token: FB_PAGE_TOKEN,
  });
  if (since) {
    // Meta acepta filtering por created_time. Le restamos 1s para no perder el último.
    const sinceDt = new Date(new Date(since).getTime() - 1000).toISOString();
    params.set('filtering', JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(new Date(sinceDt).getTime() / 1000) }]));
  }

  const leads: MetaLead[] = [];
  let url = `https://graph.facebook.com/v21.0/${formId}/leads?${params.toString()}`;
  let safety = 0;

  while (url && safety++ < 10) { // max 10 pages = 1000 leads por form por run
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn('Meta fetch fail', formId, resp.status, await resp.text());
      break;
    }
    const json = await resp.json() as { data?: MetaLead[]; paging?: { next?: string } };
    leads.push(...(json.data ?? []));
    url = json.paging?.next ?? '';
  }
  return leads;
}

function extractFields(lead: MetaLead) {
  const map: Record<string, string> = {};
  for (const f of lead.field_data) {
    map[f.name] = (f.values?.[0] ?? '').trim();
  }
  return {
    name: map.full_name ?? map.name ?? 'Sin nombre',
    phone: map.phone_number ?? map.phone ?? '',
    email: (map.email ?? '').toLowerCase(),
    // El resto va a notes como key: value
    extras: Object.entries(map)
      .filter(([k]) => !['full_name', 'name', 'phone_number', 'phone', 'email'].includes(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n'),
  };
}

async function syncForm(form: FormConfig): Promise<{ inserted: number; skipped: number; errored: number }> {
  const leads = await fetchLeadsForForm(form.form_id, form.last_synced_at);
  let inserted = 0, skipped = 0, errored = 0;
  let newestCreatedTime = form.last_synced_at;
  let newestLeadId = form.last_lead_id;

  for (const lead of leads) {
    const f = extractFields(lead);
    const phoneNorm = normalizePhone(f.phone);
    const emailNorm = f.email;

    // Dedup contra contacts existentes
    let duplicate = false;
    if (emailNorm) {
      const { data } = await sb.from('contacts').select('id').eq('email', emailNorm).limit(1);
      if (data && data.length > 0) duplicate = true;
    }
    if (!duplicate && phoneNorm && phoneNorm.length >= 8) {
      // Buscar contacts con phone que matchee al normalizar
      const { data } = await sb.from('contacts').select('id, phone').not('phone', 'is', null).limit(2000);
      if (data?.some(c => c.phone && normalizePhone(c.phone) === phoneNorm)) {
        duplicate = true;
      }
    }

    if (duplicate) {
      skipped++;
    } else {
      const propertyTitle = form.category === 'project_specific' ? form.project_name : null;
      const notesBlock = [
        `📥 Lead form Meta Ads: ${form.label}`,
        f.extras,
      ].filter(Boolean).join('\n');

      const { error } = await sb.from('contacts').insert({
        name: f.name,
        phone: f.phone || null,
        email: emailNorm || null,
        channel: 'facebook',
        channel_id: `meta_lead_${lead.id}`,
        status: 'new',
        current_stage_key: 'nuevo',
        assigned_to: null,
        property_title: propertyTitle,
        notes: notesBlock,
        branch: form.default_branch,
      });
      if (error) {
        if (error.code === '23505') {
          // Unique constraint violation: channel_id+channel ya existe. Esto pasa si
          // el mismo lead viene en una segunda corrida (debería estar filtrado por
          // last_synced_at pero por las dudas).
          skipped++;
        } else {
          console.warn('insert fail', error);
          errored++;
        }
      } else {
        inserted++;
      }
    }

    // Trackear el más nuevo para próximo sync
    if (!newestCreatedTime || lead.created_time > newestCreatedTime) {
      newestCreatedTime = lead.created_time;
      newestLeadId = lead.id;
    }
  }

  // Actualizar tracking
  await sb.from('meta_form_sync').update({
    last_synced_at: new Date().toISOString(),
    last_lead_id: newestLeadId,
    total_synced: form.total_synced + inserted,
  }).eq('form_id', form.form_id);

  return { inserted, skipped, errored };
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (!cors) return new Response('Forbidden origin', { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const { data: forms, error } = await sb
    .from('meta_form_sync')
    .select('*')
    .eq('active', true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
  }

  const startedAt = new Date().toISOString();
  const results: { form: string; label: string; inserted: number; skipped: number; errored: number }[] = [];

  for (const form of (forms ?? []) as FormConfig[]) {
    try {
      const r = await syncForm(form);
      results.push({ form: form.form_id, label: form.label, ...r });
    } catch (ex) {
      console.error('syncForm failed', form.form_id, ex);
      results.push({ form: form.form_id, label: form.label, inserted: 0, skipped: 0, errored: 1 });
    }
  }

  const totals = results.reduce(
    (acc, r) => ({
      inserted: acc.inserted + r.inserted,
      skipped: acc.skipped + r.skipped,
      errored: acc.errored + r.errored,
    }),
    { inserted: 0, skipped: 0, errored: 0 },
  );

  return new Response(JSON.stringify({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    totals,
    by_form: results,
  }), { status: 200, headers: cors });
});
