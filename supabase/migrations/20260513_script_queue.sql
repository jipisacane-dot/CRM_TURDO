-- Cola de guiones: Lety pega URL de propiedad + nota,
-- Jipi recibe notificación por Telegram con resumen IA + código de tracking,
-- responde en Telegram → su respuesta vuelve al CRM como el guion completo.

CREATE TABLE IF NOT EXISTS script_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_code text NOT NULL UNIQUE,
  url text NOT NULL,
  note text,
  requested_by uuid REFERENCES agents(id),
  requested_by_name text,
  ai_summary text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'notified', 'in_progress', 'completed', 'cancelled')),
  jipi_response text,
  telegram_msg_id_out bigint,
  telegram_msg_id_in bigint,
  created_at timestamptz DEFAULT now(),
  notified_at timestamptz,
  completed_at timestamptz,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_script_queue_status ON script_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_script_queue_tracking ON script_queue(tracking_code);

-- Auto-generar tracking_code tipo G-0001, G-0002...
CREATE SEQUENCE IF NOT EXISTS script_queue_seq START 1;

CREATE OR REPLACE FUNCTION fn_set_script_tracking_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tracking_code IS NULL OR NEW.tracking_code = '' THEN
    NEW.tracking_code := 'G-' || LPAD(nextval('script_queue_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_script_tracking_code ON script_queue;
CREATE TRIGGER trg_set_script_tracking_code
BEFORE INSERT ON script_queue
FOR EACH ROW EXECUTE FUNCTION fn_set_script_tracking_code();

-- Trigger: cuando status cambia a 'completed', stampear completed_at
CREATE OR REPLACE FUNCTION fn_script_queue_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    ELSIF NEW.status = 'notified' AND NEW.notified_at IS NULL THEN
      NEW.notified_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_script_queue_status_change ON script_queue;
CREATE TRIGGER trg_script_queue_status_change
BEFORE UPDATE ON script_queue
FOR EACH ROW EXECUTE FUNCTION fn_script_queue_status_change();
