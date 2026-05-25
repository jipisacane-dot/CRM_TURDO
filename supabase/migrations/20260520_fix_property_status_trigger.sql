-- Fix: el trigger trg_log_property_status_change estaba como BEFORE INSERT y
-- al insertar en property_status_history con NEW.id la FK fallaba porque la
-- fila en properties todavía no existía. Separar en 2 triggers:
--   - BEFORE UPDATE: actualizar published_at/unpublished_at (necesita modificar NEW)
--   - AFTER INSERT OR UPDATE: insertar en property_status_history (necesita la FK existente)

DROP TRIGGER IF EXISTS trg_log_property_status_change ON properties;

-- BEFORE UPDATE: solo manejo de published_at/unpublished_at
CREATE OR REPLACE FUNCTION fn_property_published_at_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_published IS DISTINCT FROM NEW.is_published THEN
    IF NEW.is_published THEN
      NEW.published_at := now();
    ELSE
      NEW.unpublished_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_property_published_at ON properties;
CREATE TRIGGER trg_property_published_at
BEFORE UPDATE ON properties
FOR EACH ROW EXECUTE FUNCTION fn_property_published_at_update();

-- AFTER INSERT OR UPDATE: log de status en historial
CREATE OR REPLACE FUNCTION fn_log_property_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO property_status_history (property_id, old_status, new_status)
    VALUES (NEW.id, NULL, NEW.status);
  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO property_status_history (property_id, old_status, new_status)
      VALUES (NEW.id, OLD.status, NEW.status);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_log_property_status_change
AFTER INSERT OR UPDATE ON properties
FOR EACH ROW EXECUTE FUNCTION fn_log_property_status_change();
