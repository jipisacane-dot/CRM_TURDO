-- Detección automática de leads duplicados.
-- Al insertar un contact, si hay otro con mismo phone o email no nulos, se marca duplicate_of.
-- Esto NO bloquea la creación (los webhooks ya hacen upsert), solo trackea para UI.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS duplicate_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS contacts_duplicate_of_idx ON public.contacts(duplicate_of) WHERE duplicate_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_phone_lower_idx ON public.contacts(LOWER(phone)) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_email_lower_idx ON public.contacts(LOWER(email)) WHERE email IS NOT NULL;

-- Función que busca duplicados por phone o email para un contact_id dado.
-- Marca duplicate_of con el ID del contact MÁS VIEJO con mismo phone/email.
CREATE OR REPLACE FUNCTION public.fn_detect_duplicate(target_id uuid)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  target_phone text;
  target_email text;
  target_created_at timestamptz;
  match_id uuid;
BEGIN
  SELECT phone, email, created_at INTO target_phone, target_email, target_created_at
  FROM public.contacts WHERE id = target_id;

  IF target_phone IS NULL AND target_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- Buscar el contact más viejo con mismo phone (normalizado) o email (lower)
  SELECT id INTO match_id
  FROM public.contacts
  WHERE id != target_id
    AND duplicate_of IS NULL
    AND created_at < target_created_at
    AND (
      (target_phone IS NOT NULL AND regexp_replace(LOWER(phone), '[^0-9]', '', 'g') = regexp_replace(LOWER(target_phone), '[^0-9]', '', 'g'))
      OR (target_email IS NOT NULL AND LOWER(email) = LOWER(target_email))
    )
  ORDER BY created_at ASC
  LIMIT 1;

  UPDATE public.contacts
  SET duplicate_of = match_id, duplicate_checked_at = now()
  WHERE id = target_id;

  RETURN match_id;
END;
$$;

-- Trigger AFTER INSERT que dispara la detección.
-- (Se hace fuera de la transacción del insert para no bloquear webhook si hay error.)
CREATE OR REPLACE FUNCTION public.fn_contacts_detect_duplicate_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.fn_detect_duplicate(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_detect_duplicate ON public.contacts;
CREATE TRIGGER trg_contacts_detect_duplicate
AFTER INSERT ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.fn_contacts_detect_duplicate_trigger();

-- Backfill: detectar duplicados en contactos existentes que no fueron chequeados antes.
-- Se ejecuta una sola vez con esta migration.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.contacts
    WHERE duplicate_checked_at IS NULL
      AND (phone IS NOT NULL OR email IS NOT NULL)
    ORDER BY created_at ASC
  LOOP
    PERFORM public.fn_detect_duplicate(r.id);
  END LOOP;
END $$;

-- Vista para listar duplicados con datos útiles
CREATE OR REPLACE VIEW public.v_duplicate_contacts AS
SELECT
  c.id            AS duplicate_id,
  c.name          AS duplicate_name,
  c.channel       AS duplicate_channel,
  c.created_at    AS duplicate_created_at,
  c.assigned_to   AS duplicate_assigned_to,
  o.id            AS original_id,
  o.name          AS original_name,
  o.channel       AS original_channel,
  o.created_at    AS original_created_at,
  o.assigned_to   AS original_assigned_to,
  COALESCE(c.phone, o.phone) AS phone,
  COALESCE(c.email, o.email) AS email
FROM public.contacts c
JOIN public.contacts o ON o.id = c.duplicate_of
ORDER BY c.created_at DESC;
