-- Limpiar la propiedad de test que se generó al validar matching
DELETE FROM public.properties WHERE tokko_sku = 'TEST-001';

-- Trigger: cuando se inserta o actualiza una propiedad disponible, dispara el matching contra todos los leads.
-- Solo se ejecuta para INSERT (al cargar una nueva) o cuando cambia el precio/status/rooms de manera significativa.
CREATE OR REPLACE FUNCTION public.fn_property_auto_match()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lead_row record;
BEGIN
  -- Skip si la propiedad no está disponible
  IF NEW.status IS NOT NULL AND NEW.status NOT IN ('disponible', 'available') THEN
    RETURN NEW;
  END IF;

  -- Solo evaluar en INSERT o cuando cambian datos relevantes
  IF TG_OP = 'UPDATE' AND
     COALESCE(NEW.list_price_usd, 0) = COALESCE(OLD.list_price_usd, 0) AND
     COALESCE(NEW.barrio, '') = COALESCE(OLD.barrio, '') AND
     COALESCE(NEW.rooms, 0) = COALESCE(OLD.rooms, 0) AND
     COALESCE(NEW.status, '') = COALESCE(OLD.status, '') THEN
    RETURN NEW;
  END IF;

  -- Iterar sobre todos los leads con preferences (max 200 por property por safety)
  FOR lead_row IN
    SELECT contact_id FROM public.lead_preferences LIMIT 200
  LOOP
    PERFORM public.fn_upsert_match(NEW.id, lead_row.contact_id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_property_auto_match ON public.properties;
CREATE TRIGGER trg_property_auto_match
AFTER INSERT OR UPDATE ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.fn_property_auto_match();

-- Trigger inverso: cuando se actualizan preferences de un lead, evaluar contra todas las propiedades disponibles
CREATE OR REPLACE FUNCTION public.fn_preferences_auto_match()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prop_row record;
BEGIN
  FOR prop_row IN
    SELECT id FROM public.properties
    WHERE status IN ('disponible', 'available') OR status IS NULL
    LIMIT 100
  LOOP
    PERFORM public.fn_upsert_match(prop_row.id, NEW.contact_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preferences_auto_match ON public.lead_preferences;
CREATE TRIGGER trg_preferences_auto_match
AFTER INSERT OR UPDATE ON public.lead_preferences
FOR EACH ROW EXECUTE FUNCTION public.fn_preferences_auto_match();
