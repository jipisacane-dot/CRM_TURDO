-- =========================================================================
-- COMISIONES v2 — escalonado mensual + flujo de aprobación + negociaciones
-- =========================================================================
-- Reemplaza la lógica del 28/04 (1%+1%+3% fijo + sueldo fijo) por:
--   - Turdo cobra 6% del precio (configurable por operación)
--   - Vendedor cobra escalonado sobre ese 6%, según orden de venta del mes:
--       1ra venta: 20%   |   2da: 25%   |   3ra+: 30%
--   - SIN sueldo fijo
--   - Captador queda como info (no genera comisión propia)
--
-- Flujo nuevo:
--   1. Vendedor carga venta  → approval_status = 'pending'  (sin comisión aún)
--   2. Leticia aprueba       → 'approved'                    (genera comisión)
--   3. Leticia marca pagada  → paid_at set                   (no afecta cálculo)
--   3'. Leticia rechaza      → 'rejected' + rejected_reason  (sin comisión)
--
-- Tracking de negociaciones:
--   Tabla property_negotiations: vendedor marca propiedad como "en negociación"
--   antes de que haya boleto. No genera comisión, solo visibilidad para Leti.
-- =========================================================================

-- 0. AGENTES: sin sueldo fijo
update agents set base_salary_ars = 0 where base_salary_ars > 0;
alter table agents alter column base_salary_ars set default 0;

-- 1. OPERATIONS: ampliar status + flujo de aprobación + comisión configurable
alter table operations
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists approved_by uuid references agents(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists paid_at timestamptz,
  add column if not exists agency_commission_pct numeric(5,2) not null default 6.0;

create index if not exists idx_operations_approval on operations(approval_status);
create index if not exists idx_operations_paid on operations(paid_at) where paid_at is not null;

-- 2. COMMISSIONS: agregar nivel escalonado + monto base
alter table commissions
  add column if not exists nivel_escalonado int,
  add column if not exists comision_total_usd numeric(14,2),  -- 6% de Turdo
  add column if not exists agency_commission_pct numeric(5,2) default 6.0;

-- 3. Tabla NEGOCIACIONES (propiedades en proceso, antes del boleto)
create table if not exists property_negotiations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  notes text,
  status text not null default 'activa'
    check (status in ('activa', 'cerrada', 'caida')),
  closed_at timestamptz,
  closed_reason text,
  operation_id uuid references operations(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_negotiations_agent on property_negotiations(agent_id, status);
create index if not exists idx_negotiations_property on property_negotiations(property_id, status);

alter table property_negotiations enable row level security;
drop policy if exists "negotiations_all" on property_negotiations;
create policy "negotiations_all" on property_negotiations for all using (true) with check (true);

-- 4. Quitar triggers viejos (los reemplazamos)
drop trigger if exists trg_calc_commissions on operations;
drop trigger if exists trg_sync_mes_liquidacion on operations;
drop trigger if exists trg_update_operations_pipeline on operations;
drop function if exists fn_calc_commissions();
drop function if exists fn_sync_mes_liquidacion();
drop function if exists fn_update_operations_pipeline();

-- 5. Función para recalcular comisiones de un (vendedor, mes) completo
create or replace function fn_recalc_commissions(p_vendedor_id uuid, p_mes date)
returns void
language plpgsql
security definer
as $$
declare
  rec record;
  orden int := 0;
  pct_escalonado numeric(5,2);
  pct_agencia numeric(5,2);
  comision_total_calc numeric(14,2);
  comision_agente_calc numeric(14,2);
begin
  -- Borrar comisiones existentes de venta para ese mes/vendedor
  delete from commissions
  where agent_id = p_vendedor_id
    and mes_liquidacion = p_mes
    and tipo = 'venta';

  -- Recorrer operations approved + activas, en orden cronológico
  for rec in
    select id, precio_venta_usd, fecha_boleto, agency_commission_pct
    from operations
    where vendedor_id = p_vendedor_id
      and date_trunc('month', fecha_boleto)::date = p_mes
      and approval_status = 'approved'
      and status in ('boleto', 'escriturada')
    order by fecha_boleto, created_at
  loop
    orden := orden + 1;
    pct_escalonado := case
      when orden = 1 then 20.0
      when orden = 2 then 25.0
      else 30.0
    end;
    pct_agencia := coalesce(rec.agency_commission_pct, 6.0);
    comision_total_calc := round(rec.precio_venta_usd * pct_agencia / 100, 2);
    comision_agente_calc := round(comision_total_calc * pct_escalonado / 100, 2);

    insert into commissions (
      operation_id, agent_id, tipo,
      porcentaje, nivel_escalonado,
      agency_commission_pct, comision_total_usd, monto_usd,
      mes_liquidacion, active
    ) values (
      rec.id, p_vendedor_id, 'venta',
      pct_escalonado, orden,
      pct_agencia, comision_total_calc, comision_agente_calc,
      p_mes, true
    );
  end loop;
end;
$$;

-- 6. Trigger en operations: recalcula al insertar/actualizar/borrar
create or replace function fn_operations_recalc() returns trigger
language plpgsql
security definer
as $$
declare
  mes_new date;
  mes_old date;
begin
  -- Si la operation tiene fecha_boleto, calcular su mes
  if tg_op in ('INSERT', 'UPDATE') and new.fecha_boleto is not null then
    mes_new := date_trunc('month', new.fecha_boleto)::date;

    -- Sincronizar mes_liquidacion en commissions ya existentes (por si cambió fecha)
    update commissions set mes_liquidacion = mes_new
      where operation_id = new.id;

    -- Recalcular el mes del vendedor actual
    perform fn_recalc_commissions(new.vendedor_id, mes_new);

    -- Si cambió vendedor o fecha_boleto en UPDATE, recalc también el contexto viejo
    if tg_op = 'UPDATE' and old.fecha_boleto is not null then
      mes_old := date_trunc('month', old.fecha_boleto)::date;
      if old.vendedor_id is distinct from new.vendedor_id
         or mes_old <> mes_new then
        perform fn_recalc_commissions(old.vendedor_id, mes_old);
      end if;
    end if;

    -- Si pasó a estado 'cancelada' → liberar la propiedad
    if tg_op = 'UPDATE' and old.status <> 'cancelada' and new.status = 'cancelada' then
      update properties set status = 'disponible', updated_at = now()
        where id = new.property_id;
      if new.cancelled_at is null then
        new.cancelled_at := now();
      end if;
    end if;

    -- Si está approved + boleto/escriturada → marcar propiedad vendida
    if new.approval_status = 'approved' and new.status in ('boleto', 'escriturada') then
      update properties set status = 'vendida', updated_at = now()
        where id = new.property_id and status <> 'vendida';
    end if;

  elsif tg_op = 'DELETE' and old.fecha_boleto is not null then
    perform fn_recalc_commissions(old.vendedor_id, date_trunc('month', old.fecha_boleto)::date);
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trg_operations_recalc
  after insert or update or delete on operations
  for each row execute function fn_operations_recalc();

-- 7. Trigger BEFORE UPDATE: setear timestamps automáticos del flujo de aprobación
create or replace function fn_operations_set_timestamps() returns trigger
language plpgsql
as $$
begin
  -- approved_at: cuando approval_status pasa a 'approved'
  if old.approval_status is distinct from new.approval_status
     and new.approval_status = 'approved'
     and new.approved_at is null then
    new.approved_at := now();
  end if;

  -- limpiar approved_at si vuelve a pending/rejected
  if new.approval_status <> 'approved' then
    new.approved_at := null;
  end if;

  -- limpiar rejected_reason si ya no está rejected
  if old.approval_status = 'rejected' and new.approval_status <> 'rejected' then
    new.rejected_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_operations_set_timestamps on operations;
create trigger trg_operations_set_timestamps
  before update on operations
  for each row execute function fn_operations_set_timestamps();

-- 8. Vista resumen mensual del vendedor (para MyCommissions)
create or replace view v_my_commissions_monthly as
select
  c.agent_id,
  a.name as agent_name,
  c.mes_liquidacion,
  count(*) as ventas_aprobadas,
  sum(case when c.nivel_escalonado = 1 then 1 else 0 end) as v1_count,
  sum(case when c.nivel_escalonado = 2 then 1 else 0 end) as v2_count,
  sum(case when c.nivel_escalonado >= 3 then 1 else 0 end) as v3plus_count,
  sum(c.comision_total_usd) as comision_turdo_total_usd,
  sum(c.monto_usd) as comision_agente_total_usd,
  sum(c.monto_usd) filter (where c.paid) as cobrado_usd,
  sum(c.monto_usd) filter (where not c.paid) as pendiente_cobro_usd
from commissions c
join agents a on a.id = c.agent_id
where c.tipo = 'venta' and c.active
group by c.agent_id, a.name, c.mes_liquidacion;

-- 9. Vista de pendientes de aprobación (para Leti)
create or replace view v_operations_pending_approval as
select
  o.id,
  o.property_id,
  p.address as property_address,
  o.vendedor_id,
  va.name as vendedor_name,
  o.precio_venta_usd,
  o.agency_commission_pct,
  o.fecha_boleto,
  o.status,
  o.notes,
  o.created_at,
  -- preview de la comisión SI se aprobara ahora (orden basado en pendientes + aprobadas)
  (
    select count(*) + 1
    from operations o2
    where o2.vendedor_id = o.vendedor_id
      and date_trunc('month', o2.fecha_boleto) = date_trunc('month', o.fecha_boleto)
      and o2.id <> o.id
      and o2.approval_status = 'approved'
      and o2.status in ('boleto', 'escriturada')
      and (o2.fecha_boleto < o.fecha_boleto
           or (o2.fecha_boleto = o.fecha_boleto and o2.created_at < o.created_at))
  ) as orden_estimado
from operations o
left join properties p on p.id = o.property_id
left join agents va on va.id = o.vendedor_id
where o.approval_status = 'pending';

-- 10. Vista negociaciones activas por agente
create or replace view v_negotiations_active as
select
  n.id,
  n.agent_id,
  a.name as agent_name,
  n.property_id,
  p.address as property_address,
  n.contact_id,
  c.name as contact_name,
  n.notes,
  n.created_at
from property_negotiations n
join agents a on a.id = n.agent_id
left join properties p on p.id = n.property_id
left join contacts c on c.id = n.contact_id
where n.status = 'activa';

-- 11. Drop vista vieja v_payroll_monthly (la reemplaza la nueva v_my_commissions_monthly)
drop view if exists v_payroll_monthly;
