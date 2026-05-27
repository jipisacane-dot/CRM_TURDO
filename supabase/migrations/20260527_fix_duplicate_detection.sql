-- Fix del trigger de deteccion de duplicados.
--
-- Bug reportado por Leti: contactos que mandan un lead form Y ya tenian
-- conversacion abierta por WSP aparecian duplicados en la bandeja.
-- Ejemplo: "Agnès +5491166506541" (WSP inbound) y "Agnès +541166506541"
-- (lead form). Mismo humano, dos contactos.
--
-- Causa raiz: fn_contacts_detect_duplicate_trigger() llamaba a
-- fn_detect_duplicate(NEW.id) pero esa funcion es trigger function (sin params).
-- La llamada fallaba silenciosamente y duplicate_of nunca se seteaba.
--
-- Fix: reescribir el trigger para hacer todo inline. Ademas, ya que detectamos
-- el duplicado, copiamos property_title (si el original no tiene) y appendeamos
-- notes (sin re-appendear si ya estaba). Asi la info del lead form (presupuesto,
-- ambientes, etc) que venia en el duplicado, queda visible en el original que
-- es donde el vendor responde.
--
-- Backfill aplicado en produccion (2026-05-27):
--   - 147 contactos marcados con duplicate_of
--   - 143 originales recibieron property_title + notes merged
--   - 151 mensajes sinteticos del lead form movidos al contacto original

CREATE OR REPLACE FUNCTION public.fn_contacts_detect_duplicate_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  existing_id UUID;
BEGIN
  -- Match por telefono normalizado
  IF NEW.phone_normalized IS NOT NULL THEN
    SELECT id INTO existing_id
    FROM contacts
    WHERE phone_normalized = NEW.phone_normalized
      AND id != NEW.id
      AND duplicate_of IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- Match por email si no hubo match por phone
  IF existing_id IS NULL AND NEW.email IS NOT NULL AND NEW.email != '' THEN
    SELECT id INTO existing_id
    FROM contacts
    WHERE LOWER(email) = LOWER(NEW.email)
      AND id != NEW.id
      AND duplicate_of IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF existing_id IS NOT NULL THEN
    -- Marcar NEW como duplicado
    UPDATE contacts
    SET duplicate_of = existing_id,
        duplicate_checked_at = NOW()
    WHERE id = NEW.id;

    -- Merge data: copiar property_title y appender notes al original
    UPDATE contacts orig
    SET property_title = COALESCE(orig.property_title, NEW.property_title),
        notes = CASE
          WHEN NEW.notes IS NULL OR NEW.notes = '' THEN orig.notes
          WHEN orig.notes IS NULL OR orig.notes = '' THEN NEW.notes
          WHEN POSITION(NEW.notes IN orig.notes) > 0 THEN orig.notes
          ELSE orig.notes || E'\n\n' || NEW.notes
        END,
        updated_at = NOW()
    FROM (SELECT id FROM contacts WHERE id = existing_id) e
    WHERE orig.id = e.id;
  END IF;
  RETURN NEW;
END;
$$;
