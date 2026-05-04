-- =========================================================================
-- Vencimientos (#5) + NPS post-venta (#10) + Asignación de leads (#9)
-- =========================================================================

-- EXPIRATIONS / VENCIMIENTOS -------------------------------------------------
create table if not exists expirations (
  id uuid primary key default gen_random_uuid(),
  type text not null,             -- 'escritura', 'contrato', 'seguro', 'habilitacion', 'cumpleanos', 'aniversario', 'otro'
  title text not null,
  description text,
  due_date date not null,
  notify_days_before int not null default 7,
  related_id uuid,                -- referencia genérica (operation_id, property_id, contact_id...)
  related_type text,
  notified boolean not null default false,
  notified_at timestamptz,
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references agents(id),
  created_at timestamptz default now()
);

create index if not exists idx_expirations_due on expirations(due_date) where not resolved;
create index if not exists idx_expirations_pending on expirations(notified, due_date);

alter table expirations enable row level security;
drop policy if exists "exp_all" on expirations;
create policy "exp_all" on expirations for all using (true) with check (true);

-- Trigger: cuando se crea una operation con fecha_escritura → crear vencimiento
create or replace function fn_create_escritura_expiration() returns trigger
language plpgsql
security definer
as $$
begin
  if new.fecha_escritura is not null and (tg_op = 'INSERT' or new.fecha_escritura is distinct from old.fecha_escritura) then
    -- Borra vencimientos previos de esta operación
    delete from expirations where related_id = new.id and related_type = 'operation' and type = 'escritura';
    -- Inserta nuevo
    insert into expirations (type, title, description, due_date, related_id, related_type, notify_days_before)
    values (
      'escritura',
      'Escritura programada',
      coalesce((select address from properties where id = new.property_id), 'Propiedad'),
      new.fecha_escritura,
      new.id,
      'operation',
      14
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_create_escritura_exp_ins on operations;
drop trigger if exists trg_create_escritura_exp_upd on operations;
create trigger trg_create_escritura_exp_ins after insert on operations
  for each row execute function fn_create_escritura_expiration();
create trigger trg_create_escritura_exp_upd after update on operations
  for each row execute function fn_create_escritura_expiration();

-- NPS POST-VENTA -------------------------------------------------------------
create table if not exists nps_surveys (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references operations(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  send_at date not null,           -- cuándo se debe enviar
  sent boolean not null default false,
  sent_at timestamptz,
  channel text,                    -- 'whatsapp', 'email'
  score int,                       -- 0..10
  feedback text,
  responded_at timestamptz,
  created_at timestamptz default now(),
  unique (operation_id)
);

create index if not exists idx_nps_send on nps_surveys(send_at, sent);

alter table nps_surveys enable row level security;
drop policy if exists "nps_all" on nps_surveys;
create policy "nps_all" on nps_surveys for all using (true) with check (true);

-- Trigger: cuando se escritura, programar NPS para 30 días después
create or replace function fn_schedule_nps() returns trigger
language plpgsql
security definer
as $$
begin
  if new.status = 'escriturada' and (tg_op = 'INSERT' or old.status <> 'escriturada') then
    insert into nps_surveys (operation_id, contact_id, send_at)
    values (
      new.id,
      new.contact_id,
      coalesce(new.fecha_escritura, current_date) + interval '30 days'
    )
    on conflict (operation_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_schedule_nps_ins on operations;
drop trigger if exists trg_schedule_nps_upd on operations;
create trigger trg_schedule_nps_ins after insert on operations
  for each row execute function fn_schedule_nps();
create trigger trg_schedule_nps_upd after update on operations
  for each row execute function fn_schedule_nps();

-- ASSIGNMENT (#9) ------------------------------------------------------------
-- Configuración global + por agente para asignación automática de leads
create table if not exists assignment_config (
  id int primary key default 1,
  enabled boolean not null default false,
  strategy text not null default 'round_robin' check (strategy in ('round_robin', 'load_balanced', 'manual')),
  default_branch text,
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);

insert into assignment_config (id, enabled, strategy)
values (1, false, 'round_robin')
on conflict (id) do nothing;

create table if not exists agent_capacity (
  agent_id uuid primary key references agents(id) on delete cascade,
  branch text,
  channels text[] default array['whatsapp','instagram','facebook','web']::text[],
  max_active_leads int default 30,
  available boolean default true,
  priority int default 0,
  last_assigned_at timestamptz,
  updated_at timestamptz default now()
);

alter table assignment_config enable row level security;
alter table agent_capacity enable row level security;
drop policy if exists "ac_all" on assignment_config;
drop policy if exists "agc_all" on agent_capacity;
create policy "ac_all" on assignment_config for all using (true) with check (true);
create policy "agc_all" on agent_capacity for all using (true) with check (true);

-- Función helper: asignar siguiente vendedor
create or replace function fn_pick_next_agent(p_branch text default null, p_channel text default 'whatsapp')
returns uuid
language plpgsql
security definer
as $$
declare
  picked uuid;
begin
  -- Estrategia: el agente disponible con menos leads activos asignados, desempate por last_assigned_at más viejo
  with active_count as (
    select c.assigned_to as agent_id_str, count(*) as active_leads
    from contacts c
    where c.assigned_to is not null
      and c.status not in ('won', 'lost', 'closed')
    group by c.assigned_to
  )
  select a.id into picked
  from agents a
  join agent_capacity cap on cap.agent_id = a.id
  left join active_count ac on ac.agent_id_str = a.id::text
  where a.role = 'agent'
    and a.active
    and cap.available
    and (p_branch is null or cap.branch = p_branch or cap.branch is null)
    and (p_channel is null or p_channel = any(cap.channels))
    and coalesce(ac.active_leads, 0) < coalesce(cap.max_active_leads, 30)
  order by coalesce(ac.active_leads, 0) asc, coalesce(cap.last_assigned_at, '1970-01-01') asc, cap.priority desc
  limit 1;

  if picked is not null then
    update agent_capacity set last_assigned_at = now(), updated_at = now() where agent_id = picked;
  end if;

  return picked;
end;
$$;
