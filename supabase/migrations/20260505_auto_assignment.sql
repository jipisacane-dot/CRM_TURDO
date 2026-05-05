-- Auto-asignación inteligente de leads nuevos.
-- Cuando entra un contact sin assigned_to (y assignment_config.enabled=true), un trigger
-- selecciona el vendedor con menor carga activa que pueda manejar ese canal/sucursal.

-- Asegurar que existe una row en assignment_config (single-row table típica con id=1)
INSERT INTO public.assignment_config (id, enabled, strategy, default_branch)
VALUES (1, false, 'load_balanced', 'Sucursal Centro')
ON CONFLICT (id) DO NOTHING;

-- Si no hay datos en agent_capacity, seedear con todos los vendedores activos
-- (canales: whatsapp, instagram, facebook; max_active_leads = 50; branch del agente)
INSERT INTO public.agent_capacity (agent_id, branch, channels, max_active_leads, available, priority)
SELECT
  a.id,
  COALESCE(a.branch, 'Sucursal Centro'),
  ARRAY['whatsapp','instagram','facebook','web']::text[],
  50,
  true,
  100
FROM public.agents a
WHERE a.role = 'agent' AND a.active = true
  AND NOT EXISTS (SELECT 1 FROM public.agent_capacity ac WHERE ac.agent_id = a.id);

-- Función principal: dado un contact, devuelve el agent_id del mejor candidato
-- (o NULL si nadie califica). NO modifica nada — pure read.
CREATE OR REPLACE FUNCTION public.fn_pick_agent_for_contact(p_contact_id uuid)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  c_channel text;
  c_branch text;
  picked text;
BEGIN
  SELECT channel, branch INTO c_channel, c_branch
  FROM public.contacts WHERE id = p_contact_id;

  IF c_channel IS NULL THEN RETURN NULL; END IF;

  -- Pickup: agent con menor carga actual de leads activos (no terminales),
  -- que tenga capacity para ese canal y branch (con tolerancia: si no matchea branch, lo desempata el priority).
  SELECT agents.id::text INTO picked
  FROM public.agents
  JOIN public.agent_capacity ac ON ac.agent_id = agents.id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS active_leads
    FROM public.contacts ct
    WHERE ct.assigned_to = agents.id::text
      AND COALESCE(ct.current_stage_key, 'nuevo') NOT IN ('ganado', 'perdido')
  ) load ON true
  WHERE agents.role = 'agent'
    AND agents.active = true
    AND ac.available = true
    AND c_channel = ANY(ac.channels)
    AND COALESCE(load.active_leads, 0) < ac.max_active_leads
  ORDER BY
    CASE WHEN ac.branch = c_branch THEN 0 ELSE 1 END,  -- mismo branch primero
    COALESCE(load.active_leads, 0) ASC,                -- menos carga primero
    ac.priority DESC,                                  -- mayor priority primero
    COALESCE(ac.last_assigned_at, '1970-01-01'::timestamptz) ASC  -- round-robin
  LIMIT 1;

  RETURN picked;
END;
$$;

-- Función que aplica la asignación (UPDATE + audit en notes)
CREATE OR REPLACE FUNCTION public.fn_auto_assign_contact(p_contact_id uuid)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  picked text;
  cfg_enabled boolean;
BEGIN
  SELECT enabled INTO cfg_enabled FROM public.assignment_config WHERE id = 1;
  IF NOT COALESCE(cfg_enabled, false) THEN RETURN NULL; END IF;

  -- Solo asignar si todavía no tiene asignado
  PERFORM 1 FROM public.contacts WHERE id = p_contact_id AND assigned_to IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  picked := public.fn_pick_agent_for_contact(p_contact_id);
  IF picked IS NULL THEN RETURN NULL; END IF;

  UPDATE public.contacts
  SET assigned_to = picked,
      status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
      updated_at = now()
  WHERE id = p_contact_id;

  -- Marcar last_assigned_at para round-robin
  UPDATE public.agent_capacity
  SET last_assigned_at = now()
  WHERE agent_id = picked::uuid;

  RETURN picked;
END;
$$;

-- Trigger AFTER INSERT en contacts: auto-asigna si la config está enabled.
CREATE OR REPLACE FUNCTION public.fn_contacts_auto_assign_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    PERFORM public.fn_auto_assign_contact(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_auto_assign ON public.contacts;
CREATE TRIGGER trg_contacts_auto_assign
AFTER INSERT ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.fn_contacts_auto_assign_trigger();

-- Vista para que la UI vea la carga actual por agente
CREATE OR REPLACE VIEW public.v_agent_load AS
SELECT
  a.id,
  a.name,
  a.email,
  a.branch,
  ac.available,
  ac.max_active_leads,
  ac.channels,
  ac.priority,
  ac.last_assigned_at,
  COALESCE((
    SELECT count(*)
    FROM public.contacts ct
    WHERE ct.assigned_to = a.id::text
      AND COALESCE(ct.current_stage_key, 'nuevo') NOT IN ('ganado', 'perdido')
  ), 0) AS active_leads
FROM public.agents a
LEFT JOIN public.agent_capacity ac ON ac.agent_id = a.id
WHERE a.role = 'agent' AND a.active = true
ORDER BY active_leads DESC;
