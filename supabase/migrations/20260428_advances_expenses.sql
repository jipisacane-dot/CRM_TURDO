-- =========================================================================
-- Adelantos de comisión + Gastos / pagos a proveedores
-- =========================================================================

-- COMMISSION ADVANCES ---------------------------------------------------------
create table if not exists commission_advances (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete restrict,
  amount_usd numeric(14, 2) not null check (amount_usd > 0),
  amount_ars numeric(14, 2),
  exchange_rate numeric(10, 2),
  reason text,
  status text not null check (status in ('pendiente', 'aprobado', 'rechazado', 'liquidado')) default 'pendiente',
  requested_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid references agents(id),
  resolved_note text,
  applied_to_month date,  -- mes_liquidacion al que se descuenta
  created_at timestamptz default now()
);

create index if not exists idx_advances_agent on commission_advances(agent_id, status);
create index if not exists idx_advances_status on commission_advances(status);

alter table commission_advances enable row level security;
drop policy if exists "advances_all" on commission_advances;
create policy "advances_all" on commission_advances for all using (true) with check (true);

-- EXPENSES (gastos / pagos a proveedores) ------------------------------------
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  category text not null,    -- 'marketing', 'fotografia', 'escribano', 'mantenimiento', 'oficina', 'sueldo', 'comision', 'otro'
  description text not null,
  amount_ars numeric(14, 2) not null check (amount_ars > 0),
  payment_method text,        -- 'efectivo', 'transferencia', 'tarjeta', 'cheque', 'mp'
  paid_to text,               -- nombre proveedor
  related_operation_id uuid references operations(id) on delete set null,
  related_property_id uuid references properties(id) on delete set null,
  receipt_url text,
  notes text,
  created_by uuid references agents(id),
  created_at timestamptz default now()
);

create index if not exists idx_expenses_fecha on expenses(fecha desc);
create index if not exists idx_expenses_category on expenses(category);

alter table expenses enable row level security;
drop policy if exists "expenses_all" on expenses;
create policy "expenses_all" on expenses for all using (true) with check (true);

-- INCOMES (ingresos manuales — comisiones se calculan automáticas, esto es para otros ingresos) ---
create table if not exists incomes (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  category text not null default 'otro',  -- 'comision_operacion', 'alquiler_temporal', 'consultoria', 'otro'
  description text not null,
  amount_usd numeric(14, 2),
  amount_ars numeric(14, 2) not null check (amount_ars > 0),
  exchange_rate numeric(10, 2),
  related_operation_id uuid references operations(id) on delete set null,
  notes text,
  created_by uuid references agents(id),
  created_at timestamptz default now()
);

create index if not exists idx_incomes_fecha on incomes(fecha desc);

alter table incomes enable row level security;
drop policy if exists "incomes_all" on incomes;
create policy "incomes_all" on incomes for all using (true) with check (true);

-- VISTA: cashflow mensual ----------------------------------------------------
create or replace view v_cashflow_monthly as
select
  date_trunc('month', d.fecha)::date as mes,
  d.kind,
  d.category,
  count(*) as movs,
  sum(d.amount_ars) as total_ars
from (
  select fecha, 'income' as kind, category, amount_ars from incomes
  union all
  select fecha, 'expense' as kind, category, amount_ars from expenses
) d
group by 1, 2, 3
order by 1 desc;
