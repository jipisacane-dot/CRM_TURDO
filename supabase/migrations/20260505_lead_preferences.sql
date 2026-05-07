-- Auto-matching: leads ↔ propiedades.
-- Cada contact tiene UNA fila de preferencias (1:1). Se infiere desde mensajes + custom fields.

CREATE TABLE IF NOT EXISTS public.lead_preferences (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  zonas text[] NOT NULL DEFAULT '{}',           -- ['Plaza Mitre', 'Centro']
  rooms_min integer,
  rooms_max integer,
  surface_min integer,                          -- m² mínimos
  surface_max integer,
  budget_min_usd integer,
  budget_max_usd integer,
  property_type text,                           -- depto / casa / ph / cochera / local / terreno
  purpose text,                                 -- vivir / invertir / ambos
  timing text,                                  -- ya / 1_3m / 3_6m / explorando
  notes_extra text,                             -- algo importante que no encaja arriba
  source text NOT NULL DEFAULT 'inferred',      -- inferred / manual / manychat
  inferred_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_preferences_zonas_idx ON public.lead_preferences USING GIN(zonas);
CREATE INDEX IF NOT EXISTS lead_preferences_budget_idx ON public.lead_preferences(budget_min_usd, budget_max_usd);
CREATE INDEX IF NOT EXISTS lead_preferences_rooms_idx ON public.lead_preferences(rooms_min, rooms_max);

-- Tabla de matches sugeridos (cuando entra propiedad, se evalúa contra todos los leads).
-- No se vuelve a evaluar si ya hay registro (se invalida cuando cambian las preferences).
CREATE TABLE IF NOT EXISTS public.property_lead_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  score integer NOT NULL,                       -- 0-100
  reasons text[] NOT NULL DEFAULT '{}',         -- ['matchea zona', 'dentro de presupuesto']
  notified_at timestamptz,                      -- cuándo se le avisó al lead
  notified_by text,                             -- qué agente disparó la notificación
  dismissed_at timestamptz,                     -- vendedor desestimó este match
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(property_id, contact_id)
);

CREATE INDEX IF NOT EXISTS plm_property_score_idx ON public.property_lead_matches(property_id, score DESC);
CREATE INDEX IF NOT EXISTS plm_contact_idx ON public.property_lead_matches(contact_id);
CREATE INDEX IF NOT EXISTS plm_pending_idx ON public.property_lead_matches(property_id) WHERE notified_at IS NULL AND dismissed_at IS NULL;

-- Función para calcular score de match entre lead pref y propiedad.
-- Devuelve { score, reasons }. Score >= 60 = match interesante.
CREATE OR REPLACE FUNCTION public.fn_score_match(
  p_zonas text[], p_rooms_min int, p_rooms_max int,
  p_surface_min int, p_surface_max int,
  p_budget_min int, p_budget_max int,
  p_property_type text, p_purpose text, p_timing text,
  prop_barrio text, prop_address text, prop_rooms int, prop_surface numeric,
  prop_price int, prop_status text
) RETURNS TABLE (score int, reasons text[])
LANGUAGE plpgsql AS $$
DECLARE
  s int := 0;
  r text[] := '{}';
  zone_match boolean := false;
BEGIN
  -- No matchear si la propiedad no está disponible
  IF prop_status IS NOT NULL AND prop_status NOT IN ('disponible', 'available', 'reservada') THEN
    RETURN QUERY SELECT 0, ARRAY['propiedad no disponible']::text[];
    RETURN;
  END IF;

  -- Match de zona: comparar barrio de propiedad con array de zonas pedidas (case-insensitive, partial)
  IF array_length(p_zonas, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(p_zonas, 1) LOOP
      IF LOWER(prop_barrio) ILIKE '%' || LOWER(p_zonas[i]) || '%'
         OR LOWER(prop_address) ILIKE '%' || LOWER(p_zonas[i]) || '%'
         OR LOWER(p_zonas[i]) ILIKE '%' || LOWER(COALESCE(prop_barrio, '')) || '%' THEN
        s := s + 40;
        r := array_append(r, 'matchea zona ' || p_zonas[i]);
        zone_match := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- Match de presupuesto
  IF prop_price IS NOT NULL AND p_budget_max IS NOT NULL THEN
    IF prop_price <= p_budget_max AND (p_budget_min IS NULL OR prop_price >= p_budget_min * 0.85) THEN
      s := s + 30;
      r := array_append(r, 'dentro del presupuesto');
    ELSIF prop_price <= p_budget_max * 1.10 THEN
      s := s + 15;
      r := array_append(r, 'cerca del presupuesto (+10%)');
    END IF;
  END IF;

  -- Match de ambientes
  IF prop_rooms IS NOT NULL AND (p_rooms_min IS NOT NULL OR p_rooms_max IS NOT NULL) THEN
    IF (p_rooms_min IS NULL OR prop_rooms >= p_rooms_min)
       AND (p_rooms_max IS NULL OR prop_rooms <= p_rooms_max) THEN
      s := s + 20;
      r := array_append(r, prop_rooms || ' ambientes coincide');
    ELSIF (p_rooms_min IS NULL OR prop_rooms >= p_rooms_min - 1)
          AND (p_rooms_max IS NULL OR prop_rooms <= p_rooms_max + 1) THEN
      s := s + 10;
      r := array_append(r, 'ambientes cercanos');
    END IF;
  END IF;

  -- Match de superficie
  IF prop_surface IS NOT NULL AND (p_surface_min IS NOT NULL OR p_surface_max IS NOT NULL) THEN
    IF (p_surface_min IS NULL OR prop_surface >= p_surface_min)
       AND (p_surface_max IS NULL OR prop_surface <= p_surface_max) THEN
      s := s + 10;
      r := array_append(r, 'superficie coincide');
    END IF;
  END IF;

  -- Boost timing (cliente que ya quiere comprar)
  IF p_timing IN ('ya', '1_3m') THEN
    s := s + 5;
    r := array_append(r, 'cliente con timing inmediato');
  END IF;

  RETURN QUERY SELECT s, r;
END;
$$;

-- Helper: inserta o actualiza el match para un par (property, contact)
CREATE OR REPLACE FUNCTION public.fn_upsert_match(p_property_id uuid, p_contact_id uuid)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  prop_row record;
  pref_row record;
  result_score int := 0;
  result_reasons text[] := '{}';
BEGIN
  SELECT id, address, barrio, rooms, surface_m2, list_price_usd, status
    INTO prop_row FROM public.properties WHERE id = p_property_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT contact_id, zonas, rooms_min, rooms_max, surface_min, surface_max,
         budget_min_usd, budget_max_usd, property_type, purpose, timing
    INTO pref_row FROM public.lead_preferences WHERE contact_id = p_contact_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT score, reasons INTO result_score, result_reasons
    FROM public.fn_score_match(
      pref_row.zonas, pref_row.rooms_min, pref_row.rooms_max,
      pref_row.surface_min, pref_row.surface_max,
      pref_row.budget_min_usd, pref_row.budget_max_usd,
      pref_row.property_type, pref_row.purpose, pref_row.timing,
      prop_row.barrio, prop_row.address, prop_row.rooms,
      prop_row.surface_m2, COALESCE(prop_row.list_price_usd, 0)::int, prop_row.status
    );

  IF result_score >= 50 THEN
    INSERT INTO public.property_lead_matches (property_id, contact_id, score, reasons)
    VALUES (p_property_id, p_contact_id, result_score, result_reasons)
    ON CONFLICT (property_id, contact_id)
    DO UPDATE SET score = EXCLUDED.score, reasons = EXCLUDED.reasons, dismissed_at = NULL;
  END IF;

  RETURN result_score;
END;
$$;

-- Vista enriquecida para UI: matches pendientes con datos del contacto
CREATE OR REPLACE VIEW public.v_pending_matches AS
SELECT
  m.id, m.property_id, m.contact_id, m.score, m.reasons, m.created_at,
  c.name AS contact_name,
  c.channel AS contact_channel,
  c.phone AS contact_phone,
  c.email AS contact_email,
  c.assigned_to AS contact_assigned_to,
  c.current_stage_key,
  c.quality_label,
  p.address AS property_address,
  p.barrio AS property_barrio,
  p.list_price_usd AS property_price,
  p.rooms AS property_rooms
FROM public.property_lead_matches m
JOIN public.contacts c ON c.id = m.contact_id
JOIN public.properties p ON p.id = m.property_id
WHERE m.dismissed_at IS NULL
ORDER BY m.score DESC, m.created_at DESC;
