-- =========================================================================
-- PIPELINE DE LEADS — etapas configurables + auto-mover a "en conversación"
-- =========================================================================

-- 1. Tabla de etapas
create table if not exists pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  icon text,
  color text,
  sort_order int not null,
  is_terminal boolean not null default false, -- ganado/perdido cierran el flow
  requires_followup_after_days int, -- si lleva +N días en esta etapa, alertar
  created_at timestamptz default now()
);

create index if not exists idx_stages_order on pipeline_stages(sort_order);

-- Seed: etapas default del flow inmobiliario
insert into pipeline_stages (key, name, icon, color, sort_order, is_terminal, requires_followup_after_days) values
  ('nuevo', 'Nuevo', '🆕', '#94A3B8', 10, false, null),
  ('en_conversacion', 'En conversación', '💬', '#0EA5E9', 20, false, null),
  ('visita_programada', 'Visita programada', '📅', '#F59E0B', 30, false, 1),
  ('propuesta_enviada', 'Propuesta enviada', '💼', '#A855F7', 40, false, 3),
  ('en_negociacion', 'En negociación', '🤝', '#EC4899', 50, false, 7),
  ('en_pausa', 'En pausa', '⏸️', '#64748B', 60, false, 30),
  ('ganado', 'Ganado', '✅', '#10B981', 70, true, null),
  ('perdido', 'Perdido', '❌', '#EF4444', 80, true, null)
on conflict (key) do nothing;

-- 2. Contacts: agregar etapa actual + timestamp
alter table contacts
  add column if not exists current_stage_key text default 'nuevo',
  add column if not exists stage_changed_at timestamptz default now();

-- Backfill: contactos existentes quedan en 'nuevo' (default ya lo hace)
update contacts set current_stage_key = 'nuevo', stage_changed_at = created_at
where current_stage_key is null;

create index if not exists idx_contacts_stage on contacts(current_stage_key);
create index if not exists idx_contacts_stage_agent on contacts(assigned_to, current_stage_key);

-- 3. Historial de cambios de etapa
create table if not exists contact_stage_changes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  changed_by uuid references agents(id) on delete set null,
  changed_at timestamptz default now(),
  reason text,
  auto_detected boolean not null default false
);

create index if not exists idx_stage_changes_contact on contact_stage_changes(contact_id, changed_at desc);

alter table contact_stage_changes enable row level security;
drop policy if exists "stage_changes_all" on contact_stage_changes;
create policy "stage_changes_all" on contact_stage_changes for all using (true) with check (true);

-- 4. Trigger: cuando un contacto recibe su PRIMERA respuesta (mensaje OUT),
-- pasa automáticamente de 'nuevo' a 'en_conversacion'
create or replace function fn_auto_move_to_conversation() returns trigger
language plpgsql
security definer
as $$
declare
  v_current_stage text;
  v_already_replied boolean;
begin
  if new.direction <> 'out' then return new; end if;

  select current_stage_key into v_current_stage from contacts where id = new.contact_id;
  if v_current_stage <> 'nuevo' then return new; end if;

  -- ¿Es la primera respuesta del vendedor? (no hay otros mensajes OUT antes)
  select exists(
    select 1 from messages
    where contact_id = new.contact_id and direction = 'out' and id <> new.id
  ) into v_already_replied;
  if v_already_replied then return new; end if;

  update contacts
    set current_stage_key = 'en_conversacion',
        stage_changed_at = now()
    where id = new.contact_id;

  insert into contact_stage_changes (contact_id, from_stage, to_stage, auto_detected, reason)
  values (new.contact_id, 'nuevo', 'en_conversacion', true, 'Primera respuesta del vendedor');

  return new;
end;
$$;

drop trigger if exists trg_auto_move_to_conversation on messages;
create trigger trg_auto_move_to_conversation
  after insert on messages
  for each row execute function fn_auto_move_to_conversation();

-- 5. Trigger: cada vez que cambia current_stage_key, registrar en historial
-- (para cambios manuales hechos desde la UI)
create or replace function fn_log_stage_change() returns trigger
language plpgsql
security definer
as $$
begin
  if old.current_stage_key is distinct from new.current_stage_key then
    new.stage_changed_at := now();
    insert into contact_stage_changes (contact_id, from_stage, to_stage, auto_detected)
    values (new.id, old.current_stage_key, new.current_stage_key, false);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_stage_change on contacts;
create trigger trg_log_stage_change
  before update on contacts
  for each row execute function fn_log_stage_change();

-- 6. Vista resumen pipeline por vendedor
create or replace view v_pipeline_by_agent as
select
  coalesce(c.assigned_to, '_unassigned') as agent_key,
  c.current_stage_key as stage_key,
  s.name as stage_name,
  s.color,
  s.sort_order,
  count(*) as total
from contacts c
left join pipeline_stages s on s.key = c.current_stage_key
group by c.assigned_to, c.current_stage_key, s.name, s.color, s.sort_order;

-- 7. Vista de leads en pausa que requieren seguimiento (lleva más días que el threshold)
create or replace view v_followups_due as
select
  c.id as contact_id,
  c.name,
  c.phone,
  c.channel,
  c.assigned_to,
  c.current_stage_key,
  s.name as stage_name,
  c.stage_changed_at,
  s.requires_followup_after_days,
  extract(epoch from (now() - c.stage_changed_at)) / 86400 as days_in_stage
from contacts c
join pipeline_stages s on s.key = c.current_stage_key
where s.requires_followup_after_days is not null
  and c.stage_changed_at < now() - (s.requires_followup_after_days || ' days')::interval;
