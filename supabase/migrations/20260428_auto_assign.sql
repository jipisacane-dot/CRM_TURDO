-- =========================================================================
-- Trigger de asignación automática de leads en contacts
-- =========================================================================
-- Cuando entra un nuevo contact sin assigned_to, si la asignación auto
-- está habilitada en assignment_config, se le asigna el siguiente agente.
-- =========================================================================

create or replace function fn_auto_assign_contact() returns trigger
language plpgsql
security definer
as $$
declare
  cfg_enabled boolean;
  cfg_default_branch text;
  picked uuid;
begin
  -- Solo procesar si no tiene assigned_to
  if new.assigned_to is not null and new.assigned_to <> '' then
    return new;
  end if;

  select enabled, default_branch into cfg_enabled, cfg_default_branch
    from assignment_config where id = 1;

  if not coalesce(cfg_enabled, false) then
    return new;
  end if;

  -- Pick next agent
  select fn_pick_next_agent(coalesce(new.branch, cfg_default_branch), new.channel) into picked;

  if picked is not null then
    new.assigned_to := picked::text;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_assign_contact on contacts;
create trigger trg_auto_assign_contact
  before insert on contacts
  for each row execute function fn_auto_assign_contact();

-- Seed: capacity default para cada agente activo
insert into agent_capacity (agent_id, branch, channels, max_active_leads, available, priority)
select id, branch, array['whatsapp','instagram','facebook','web']::text[], 30, true, 0
from agents where role = 'agent' and active
on conflict (agent_id) do nothing;
