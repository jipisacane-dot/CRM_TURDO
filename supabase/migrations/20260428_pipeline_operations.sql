-- =========================================================================
-- Pipeline de operaciones — estado 'reservada' + seña + ajuste de trigger
-- =========================================================================
-- Flujo:
--   reservada    → cliente firma reserva con seña (chica). Sin comisiones aún.
--   boleto       → boleto de compraventa. SE GENERAN LAS COMISIONES.
--   escriturada  → escritura firmada (cierre real).
--   cancelada    → operación cae. Comisiones se desactivan (no se borran).
-- =========================================================================

-- 1. Permitir 'reservada' en operations.status
alter table operations drop constraint if exists operations_status_check;
alter table operations add constraint operations_status_check
  check (status in ('reservada', 'boleto', 'escriturada', 'cancelada'));

-- 2. Permitir 'reservada' también en properties.status
alter table properties drop constraint if exists properties_status_check;
alter table properties add constraint properties_status_check
  check (status in ('disponible', 'reservada', 'vendida', 'archivada'));

-- 3. Nuevos campos en operations (opcional para reservas)
alter table operations
  add column if not exists fecha_reserva date,
  add column if not exists monto_sena_usd numeric(14, 2),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_reason text;

-- 4. Campo "active" en commissions (false si la operación se cancela)
alter table commissions
  add column if not exists active boolean not null default true;

create index if not exists idx_commissions_active on commissions(active);

-- 5. Reemplazar trigger fn_calc_commissions:
--    - INSERT: si status IN (boleto, escriturada) → genera commissions
--    - UPDATE: si status pasó a boleto/escriturada → genera commissions (si no existían)
--    - UPDATE: si status pasó a cancelada → marca commissions como inactive
create or replace function fn_calc_commissions() returns trigger
language plpgsql
security definer
as $$
declare
  comm_pct constant numeric(5,2) := 1.00;
  mes_liq date;
  monto_calc numeric(14,2);
  has_commissions boolean;
begin
  -- Solo procesar si status implica venta firmada
  if new.status not in ('boleto', 'escriturada') then
    return new;
  end if;

  mes_liq := date_trunc('month', new.fecha_boleto)::date;
  monto_calc := round((new.precio_venta_usd * comm_pct / 100)::numeric, 2);

  -- ¿Ya tiene commissions?
  select exists(select 1 from commissions where operation_id = new.id) into has_commissions;
  if has_commissions then
    -- reactivar (por si vino de una cancelación previa)
    update commissions set active = true where operation_id = new.id;
    return new;
  end if;

  -- Crear comisión vendedor
  insert into commissions (operation_id, agent_id, tipo, porcentaje, monto_usd, mes_liquidacion)
  values (new.id, new.vendedor_id, 'venta', comm_pct, monto_calc, mes_liq);

  -- Crear comisión captador
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

-- 6. Trigger nuevo: en UPDATE de operations
create or replace function fn_update_operations_pipeline() returns trigger
language plpgsql
security definer
as $$
declare
  comm_pct constant numeric(5,2) := 1.00;
  mes_liq date;
  monto_calc numeric(14,2);
  has_commissions boolean;
begin
  -- Si cambió fecha_boleto, recalcular mes_liquidacion en commissions existentes
  if new.fecha_boleto is distinct from old.fecha_boleto then
    update commissions
      set mes_liquidacion = date_trunc('month', new.fecha_boleto)::date
      where operation_id = new.id;
  end if;

  -- Si pasó de "no-firmado" a "firmado", generar comisiones (si aún no existen)
  if old.status not in ('boleto', 'escriturada') and new.status in ('boleto', 'escriturada') then
    select exists(select 1 from commissions where operation_id = new.id) into has_commissions;
    if not has_commissions then
      mes_liq := date_trunc('month', new.fecha_boleto)::date;
      monto_calc := round((new.precio_venta_usd * comm_pct / 100)::numeric, 2);

      insert into commissions (operation_id, agent_id, tipo, porcentaje, monto_usd, mes_liquidacion)
      values (new.id, new.vendedor_id, 'venta', comm_pct, monto_calc, mes_liq);

      if new.captador_id is not null then
        insert into commissions (operation_id, agent_id, tipo, porcentaje, monto_usd, mes_liquidacion)
        values (new.id, new.captador_id, 'captacion', comm_pct, monto_calc, mes_liq);
      end if;

      update properties set status = 'vendida', updated_at = now()
        where id = new.property_id and status <> 'vendida';
    else
      -- reactivar si estaban inactivas
      update commissions set active = true where operation_id = new.id;
    end if;
  end if;

  -- Si pasó a "cancelada", desactivar commissions y liberar la propiedad
  if old.status <> 'cancelada' and new.status = 'cancelada' then
    update commissions set active = false where operation_id = new.id;
    update properties set status = 'disponible', updated_at = now()
      where id = new.property_id;
    if new.cancelled_at is null then
      new.cancelled_at := now();
    end if;
  end if;

  -- Si pasó de cancelada a otro estado, reactivar
  if old.status = 'cancelada' and new.status <> 'cancelada' then
    update commissions set active = true where operation_id = new.id;
    new.cancelled_at := null;
    new.cancelled_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_mes_liquidacion on operations;
drop trigger if exists trg_update_operations_pipeline on operations;
create trigger trg_update_operations_pipeline
  before update on operations
  for each row execute function fn_update_operations_pipeline();

-- 7. Tabla de eventos / historial del pipeline (auditoría simple)
create table if not exists operation_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references operations(id) on delete cascade,
  event_type text not null,  -- 'created', 'status_change', 'note', 'cancelled', 'reactivated'
  from_status text,
  to_status text,
  note text,
  by_agent_id uuid references agents(id),
  created_at timestamptz default now()
);

create index if not exists idx_operation_events_op on operation_events(operation_id, created_at desc);

alter table operation_events enable row level security;
drop policy if exists "events_all" on operation_events;
create policy "events_all" on operation_events for all using (true) with check (true);

-- 8. Trigger de auditoría: registrar cada cambio de status
create or replace function fn_log_operation_event() returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'INSERT' then
    insert into operation_events (operation_id, event_type, to_status, note)
    values (new.id, 'created', new.status, 'Operación creada');
    return new;
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into operation_events (operation_id, event_type, from_status, to_status, note)
    values (new.id, 'status_change', old.status, new.status, null);
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_op_insert on operations;
drop trigger if exists trg_log_op_update on operations;
create trigger trg_log_op_insert after insert on operations
  for each row execute function fn_log_operation_event();
create trigger trg_log_op_update after update on operations
  for each row execute function fn_log_operation_event();

-- 9. Vista helper: pipeline summary (cuántas operaciones por estado)
create or replace view v_pipeline_summary as
select
  status,
  count(*) as total,
  coalesce(sum(precio_venta_usd), 0) as volumen_usd
from operations
group by status;
