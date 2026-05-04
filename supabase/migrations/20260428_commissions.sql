-- =========================================================================
-- Módulo de comisiones y liquidación de sueldos
-- =========================================================================
-- Esquema:
--   - agents: vendedores y admin con sueldo fijo
--   - properties: propiedades captadas (interno, link opcional con Tokko)
--   - operations: ventas firmadas (boleto / escritura)
--   - commissions: comisiones generadas automáticamente al insertar operation
--   - payroll_runs: liquidaciones mensuales (sueldo + comisiones)
--
-- Reglas de negocio (Turdo):
--   - Vendedor que cierra la venta: 1% del precio
--   - Captador: 1% del precio (puede ser la misma persona)
--   - Casa (Turdo): 3% del precio
--   - Sueldo fijo: 2.000.000 ARS/mes/vendedor (independiente, suma a comisiones)
--   - Asignación al mes: por fecha del boleto
-- =========================================================================

-- AGENTS ----------------------------------------------------------------------
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  role text not null check (role in ('admin', 'agent')) default 'agent',
  base_salary_ars numeric(14, 2) not null default 2000000,
  branch text,
  active boolean not null default true,
  auth_user_id uuid references auth.users(id) on delete set null,
  phone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_agents_role on agents(role) where active;

-- PROPERTIES (captaciones internas) ------------------------------------------
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  description text,
  rooms int,
  surface_m2 numeric(8, 2),
  list_price_usd numeric(14, 2),
  status text not null check (status in ('disponible', 'reservada', 'vendida', 'archivada')) default 'disponible',
  captador_id uuid references agents(id) on delete set null,
  fecha_consignacion date not null default current_date,
  tokko_sku text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_properties_status on properties(status);
create index if not exists idx_properties_captador on properties(captador_id);

-- OPERATIONS (ventas firmadas) ------------------------------------------------
create table if not exists operations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete restrict,
  captador_id uuid references agents(id) on delete set null,
  vendedor_id uuid not null references agents(id) on delete restrict,
  precio_venta_usd numeric(14, 2) not null check (precio_venta_usd > 0),
  fecha_boleto date not null,
  fecha_escritura date,
  contact_id uuid references contacts(id) on delete set null,
  status text not null check (status in ('boleto', 'escriturada', 'cancelada')) default 'boleto',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_operations_vendedor on operations(vendedor_id);
create index if not exists idx_operations_captador on operations(captador_id);
create index if not exists idx_operations_fecha_boleto on operations(fecha_boleto);
create index if not exists idx_operations_status on operations(status);

-- COMMISSIONS (generadas por trigger) ----------------------------------------
create table if not exists commissions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references operations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete restrict,
  tipo text not null check (tipo in ('captacion', 'venta')),
  porcentaje numeric(5, 2) not null,
  monto_usd numeric(14, 2) not null,
  mes_liquidacion date not null,
  paid boolean not null default false,
  paid_at timestamptz,
  paid_by uuid references agents(id),
  created_at timestamptz default now()
);

create index if not exists idx_commissions_agent_mes on commissions(agent_id, mes_liquidacion);
create index if not exists idx_commissions_paid on commissions(paid);

-- PAYROLL_RUNS (liquidación mensual) -----------------------------------------
create table if not exists payroll_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete restrict,
  mes_liquidacion date not null,
  base_salary_ars numeric(14, 2) not null,
  commissions_total_usd numeric(14, 2) not null default 0,
  exchange_rate numeric(10, 2),
  commissions_total_ars numeric(14, 2),
  total_ars numeric(14, 2) not null default 0,
  status text not null check (status in ('pendiente', 'pagado')) default 'pendiente',
  paid_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  unique (agent_id, mes_liquidacion)
);

-- TRIGGER: al insertar operación, calcula comisiones automáticamente ----------
create or replace function fn_calc_commissions() returns trigger
language plpgsql
security definer
as $$
declare
  comm_pct constant numeric(5,2) := 1.00; -- 1% para captador y para vendedor
  mes_liq date := date_trunc('month', new.fecha_boleto)::date;
  monto_calc numeric(14,2) := round((new.precio_venta_usd * comm_pct / 100)::numeric, 2);
begin
  -- Comisión vendedor (siempre)
  insert into commissions (operation_id, agent_id, tipo, porcentaje, monto_usd, mes_liquidacion)
  values (new.id, new.vendedor_id, 'venta', comm_pct, monto_calc, mes_liq);

  -- Comisión captador (si está cargado, puede ser misma persona)
  if new.captador_id is not null then
    insert into commissions (operation_id, agent_id, tipo, porcentaje, monto_usd, mes_liquidacion)
    values (new.id, new.captador_id, 'captacion', comm_pct, monto_calc, mes_liq);
  end if;

  -- Marcar la propiedad como vendida
  update properties set status = 'vendida', updated_at = now()
  where id = new.property_id and status <> 'vendida';

  return new;
end;
$$;

drop trigger if exists trg_calc_commissions on operations;
create trigger trg_calc_commissions
  after insert on operations
  for each row execute function fn_calc_commissions();

-- TRIGGER: si se actualiza fecha_boleto, recalcular mes_liquidacion -----------
create or replace function fn_sync_mes_liquidacion() returns trigger
language plpgsql
security definer
as $$
begin
  if new.fecha_boleto is distinct from old.fecha_boleto then
    update commissions
    set mes_liquidacion = date_trunc('month', new.fecha_boleto)::date
    where operation_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_mes_liquidacion on operations;
create trigger trg_sync_mes_liquidacion
  after update on operations
  for each row execute function fn_sync_mes_liquidacion();

-- VISTA: resumen mensual por agente ------------------------------------------
create or replace view v_payroll_monthly as
select
  a.id as agent_id,
  a.name as agent_name,
  a.role,
  a.branch,
  a.base_salary_ars,
  c.mes_liquidacion,
  count(c.id) as total_comisiones,
  coalesce(sum(c.monto_usd), 0) as comisiones_usd_total,
  coalesce(sum(c.monto_usd) filter (where c.paid), 0) as comisiones_usd_pagadas,
  coalesce(sum(c.monto_usd) filter (where not c.paid), 0) as comisiones_usd_pendientes
from agents a
left join commissions c on c.agent_id = a.id
where a.active and a.role = 'agent'
group by a.id, a.name, a.role, a.branch, a.base_salary_ars, c.mes_liquidacion;

-- SEED: agentes del mock -----------------------------------------------------
insert into agents (name, email, role, branch, base_salary_ars) values
  ('Leticia Turdo',     'leticia@turdogroup.com',   'admin', null,              0),
  ('Marcos Vidal',      'marcos@turdogroup.com',    'agent', 'Sucursal Centro', 2000000),
  ('Carolina Sosa',     'carolina@turdogroup.com',  'agent', 'Sucursal Centro', 2000000),
  ('Pablo Ríos',        'pablo@turdogroup.com',     'agent', 'Sucursal Centro', 2000000),
  ('Valentina Cruz',    'valentina@turdogroup.com', 'agent', 'Sucursal Norte',  2000000),
  ('Nicolás Ferreira',  'nicolas@turdogroup.com',   'agent', 'Sucursal Norte',  2000000),
  ('Andrea Méndez',     'andrea@turdogroup.com',    'agent', 'Sucursal Norte',  2000000),
  ('Rodrigo Ibáñez',    'rodrigo@turdogroup.com',   'agent', 'Sucursal Centro', 2000000)
on conflict (email) do nothing;

-- RLS: por ahora policies permisivas (auth real más adelante) ----------------
alter table agents       enable row level security;
alter table properties   enable row level security;
alter table operations   enable row level security;
alter table commissions  enable row level security;
alter table payroll_runs enable row level security;

drop policy if exists "agents_all"      on agents;
drop policy if exists "properties_all"  on properties;
drop policy if exists "operations_all"  on operations;
drop policy if exists "commissions_all" on commissions;
drop policy if exists "payroll_all"     on payroll_runs;

create policy "agents_all"      on agents       for all using (true) with check (true);
create policy "properties_all"  on properties   for all using (true) with check (true);
create policy "operations_all"  on operations   for all using (true) with check (true);
create policy "commissions_all" on commissions  for all using (true) with check (true);
create policy "payroll_all"     on payroll_runs for all using (true) with check (true);
