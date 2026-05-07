-- =========================================================================
-- VISTAS ANALÍTICAS — embudo, tiempos, conversión, forecast, ciclo de venta
-- =========================================================================
-- Para Leticia: dashboard de métricas reales del equipo y del negocio.
-- Todas las vistas son SECURITY INVOKER para respetar RLS si se aplica.

-- 1) EMBUDO DE CONVERSIÓN — contactos / contactados / en negociación / vendidos
-- Por agente (asignación) y total. Usado para gráfico de embudo y per-vendedor.
create or replace view v_funnel_by_agent as
with contact_stats as (
  select
    coalesce(c.assigned_to, '_unassigned') as agent_key,
    count(*) as leads_total,
    count(*) filter (where exists (
      select 1 from messages m where m.contact_id = c.id and m.direction = 'out'
    )) as leads_contactados
  from contacts c
  group by coalesce(c.assigned_to, '_unassigned')
),
neg_stats as (
  -- agent_id en negotiations es uuid → convertimos a text para comparar
  select n.agent_id::text as agent_key, count(*) as negociaciones_activas
  from property_negotiations n
  where n.status = 'activa'
  group by n.agent_id::text
),
op_stats as (
  select o.vendedor_id::text as agent_key,
         count(*) filter (where o.approval_status = 'approved' and o.status in ('boleto','escriturada')) as ventas_aprobadas,
         count(*) filter (where o.approval_status = 'pending') as ventas_pendientes,
         count(*) filter (where o.approval_status = 'rejected') as ventas_rechazadas
  from operations o
  group by o.vendedor_id::text
)
select
  coalesce(cs.agent_key, ns.agent_key, os.agent_key) as agent_key,
  coalesce(cs.leads_total, 0) as leads_total,
  coalesce(cs.leads_contactados, 0) as leads_contactados,
  coalesce(ns.negociaciones_activas, 0) as negociaciones_activas,
  coalesce(os.ventas_aprobadas, 0) as ventas_aprobadas,
  coalesce(os.ventas_pendientes, 0) as ventas_pendientes,
  coalesce(os.ventas_rechazadas, 0) as ventas_rechazadas
from contact_stats cs
full outer join neg_stats ns on ns.agent_key = cs.agent_key
full outer join op_stats os on os.agent_key = coalesce(cs.agent_key, ns.agent_key);

-- 2) TIEMPO DE PRIMERA RESPUESTA por contacto
-- Diferencia (en minutos) entre creación del contacto y el primer mensaje OUT
create or replace view v_response_time as
with first_out as (
  select
    m.contact_id,
    min(m.created_at) as first_out_at,
    (array_agg(m.agent_id order by m.created_at) filter (where m.agent_id is not null))[1] as first_responder
  from messages m
  where m.direction = 'out'
  group by m.contact_id
)
select
  c.id as contact_id,
  c.created_at as contact_created,
  c.channel,
  c.assigned_to,
  fo.first_out_at,
  fo.first_responder,
  case when fo.first_out_at is not null
       then extract(epoch from (fo.first_out_at - c.created_at)) / 60.0
       else null end as response_minutes
from contacts c
left join first_out fo on fo.contact_id = c.id;

-- 3) CONVERSIÓN POR CANAL — % de leads que terminan en venta aprobada
create or replace view v_conversion_by_channel as
select
  c.channel,
  count(distinct c.id) as total_leads,
  count(distinct case when exists (
    select 1 from messages m where m.contact_id = c.id and m.direction = 'out'
  ) then c.id end) as leads_contactados,
  count(distinct n.id) as negociaciones,
  count(distinct case when o.approval_status = 'approved' and o.status in ('boleto','escriturada')
                       then o.id end) as ventas_cerradas,
  case when count(distinct c.id) > 0 then
    round(
      100.0 * count(distinct case when o.approval_status = 'approved' and o.status in ('boleto','escriturada') then c.id end)
      / count(distinct c.id),
      2
    )
  else 0 end as tasa_conversion_pct
from contacts c
left join property_negotiations n on n.contact_id = c.id
left join operations o on o.contact_id = c.id
group by c.channel
order by count(distinct c.id) desc;

-- 4) FORECAST de comisiones del próximo período
-- - Confirmadas: comisiones aprobadas pendientes de cobro del mes en curso
-- - Pending: operations con approval_status=pending (estimadas al 25% del 6%)
-- - Negociaciones activas (estimadas al 25% del 6% con prob. 30%)
create or replace view v_forecast_summary as
select
  coalesce((
    select sum(c.monto_usd)::numeric(14,2)
    from commissions c
    where c.active and not c.paid
      and c.mes_liquidacion >= date_trunc('month', current_date)
  ), 0) as comisiones_confirmadas_usd,
  coalesce((
    select sum(o.precio_venta_usd * 0.06 * 0.25)::numeric(14,2)
    from operations o
    where o.approval_status = 'pending'
      and o.status in ('boleto','escriturada')
  ), 0) as forecast_pending_usd,
  coalesce((
    select sum(p.list_price_usd * 0.06 * 0.25 * 0.30)::numeric(14,2)
    from property_negotiations n
    join properties p on p.id = n.property_id
    where n.status = 'activa' and p.list_price_usd is not null
  ), 0) as forecast_negotiations_usd,
  (select count(*) from operations where approval_status = 'pending') as ops_pendientes_count,
  (select count(*) from property_negotiations where status = 'activa') as negotiations_activas_count;

-- 5) NEGOCIACIONES CAÍDAS — motivos y promedio de días hasta que cae
create or replace view v_caidas_reasons as
select
  coalesce(closed_reason, 'sin_motivo') as reason,
  count(*) as total,
  round(avg(extract(epoch from (closed_at - created_at)) / 86400.0)) as avg_days_to_caida
from property_negotiations
where status = 'caida'
group by closed_reason
order by total desc;

-- 6) CICLO DE VENTA — días desde primer contacto hasta firma de boleto
create or replace view v_sale_cycle as
select
  o.id as op_id,
  o.vendedor_id,
  va.name as vendedor_name,
  o.fecha_boleto,
  c.created_at as contact_created_at,
  c.channel,
  o.precio_venta_usd,
  case when c.created_at is not null then
    round(extract(epoch from (o.fecha_boleto::timestamp - c.created_at)) / 86400.0)
  else null end as days_to_close
from operations o
left join contacts c on c.id = o.contact_id
left join agents va on va.id = o.vendedor_id
where o.approval_status = 'approved' and o.status in ('boleto','escriturada');

-- 7) SUMMARY MENSUAL — totales por mes para reporte mensual
create or replace view v_monthly_summary as
select
  date_trunc('month', d.day)::date as mes,
  d.kind,
  count(*) as total_count,
  coalesce(sum(d.amount), 0)::numeric(14,2) as total_amount
from (
  select created_at::date as day, 'leads_in' as kind, 0 as amount from contacts
  union all
  select created_at::date, 'messages_out', 0 from messages where direction = 'out'
  union all
  select fecha_boleto::date, 'ventas_cerradas', precio_venta_usd
    from operations
    where approval_status = 'approved' and status in ('boleto','escriturada')
  union all
  select created_at::date, 'negociaciones_inicio', 0 from property_negotiations
  union all
  select closed_at::date, 'negociaciones_caida', 0
    from property_negotiations where status = 'caida' and closed_at is not null
) d
group by 1, 2
order by 1 desc, 2;
