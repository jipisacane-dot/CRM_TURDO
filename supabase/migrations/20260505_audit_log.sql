-- Audit log: registra acciones importantes en el CRM (asignación de leads, cambio de etapa,
-- aprobación / rechazo de ventas, marca como pagada, edición de propiedades, etc).
-- Vista admin /audit para que Leticia pueda revisar quién cambió qué cuándo.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  actor_label text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_label text,
  before_data jsonb,
  after_data jsonb,
  context text
);

CREATE INDEX IF NOT EXISTS audit_log_occurred_idx ON public.audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON public.audit_log(action);

COMMENT ON TABLE public.audit_log IS 'Registro inmutable de acciones críticas. Fuente de la verdad para auditoría.';
COMMENT ON COLUMN public.audit_log.action IS 'Verbo: lead_assigned, stage_changed, operation_approved, operation_rejected, operation_paid, property_updated, etc.';
COMMENT ON COLUMN public.audit_log.entity_type IS 'Tipo del recurso afectado: contact, operation, property, negotiation, etc.';
COMMENT ON COLUMN public.audit_log.before_data IS 'Estado anterior (solo campos relevantes)';
COMMENT ON COLUMN public.audit_log.after_data IS 'Estado nuevo (solo campos relevantes)';

-- Trigger genérico para contacts
CREATE OR REPLACE FUNCTION fn_audit_contacts()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  agent_label text;
BEGIN
  -- Asignación nueva o cambio de asignación
  IF (TG_OP = 'UPDATE' AND COALESCE(NEW.assigned_to, '') <> COALESCE(OLD.assigned_to, '')) THEN
    SELECT name INTO agent_label FROM agents WHERE id::text = NEW.assigned_to;
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, after_data, actor_id)
    VALUES (
      CASE WHEN OLD.assigned_to IS NULL THEN 'lead_assigned' ELSE 'lead_reassigned' END,
      'contact', NEW.id, NEW.name,
      jsonb_build_object('assigned_to', OLD.assigned_to),
      jsonb_build_object('assigned_to', NEW.assigned_to, 'agent_name', agent_label),
      NEW.assigned_to
    );
  END IF;

  -- Cambio de etapa (solo si NO viene del trigger de stage_changes que ya logea via contact_stage_changes)
  IF (TG_OP = 'UPDATE' AND COALESCE(NEW.current_stage_key, '') <> COALESCE(OLD.current_stage_key, '')) THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, after_data)
    VALUES (
      'stage_changed', 'contact', NEW.id, NEW.name,
      jsonb_build_object('stage', OLD.current_stage_key),
      jsonb_build_object('stage', NEW.current_stage_key)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_contacts ON public.contacts;
CREATE TRIGGER trg_audit_contacts
AFTER UPDATE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION fn_audit_contacts();

-- Trigger para operations: aprobación, rechazo, pago, status changes
CREATE OR REPLACE FUNCTION fn_audit_operations()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  contact_label text;
BEGIN
  SELECT name INTO contact_label FROM contacts WHERE id = NEW.contact_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, after_data, actor_id)
    VALUES (
      'operation_created', 'operation', NEW.id,
      'Operación · ' || COALESCE(contact_label, '?'),
      jsonb_build_object('precio_venta_usd', NEW.precio_venta_usd, 'status', NEW.status, 'approval_status', NEW.approval_status),
      NEW.vendedor_id::text
    );
    RETURN NEW;
  END IF;

  -- Approval status change
  IF (TG_OP = 'UPDATE' AND COALESCE(NEW.approval_status, '') <> COALESCE(OLD.approval_status, '')) THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, after_data, actor_id, context)
    VALUES (
      CASE NEW.approval_status
        WHEN 'approved' THEN 'operation_approved'
        WHEN 'rejected' THEN 'operation_rejected'
        ELSE 'operation_approval_changed'
      END,
      'operation', NEW.id, 'Operación · ' || COALESCE(contact_label, '?'),
      jsonb_build_object('approval_status', OLD.approval_status),
      jsonb_build_object('approval_status', NEW.approval_status, 'approved_by', NEW.approved_by),
      NEW.approved_by::text,
      NEW.rejected_reason
    );
  END IF;

  -- Marcada como paid
  IF (TG_OP = 'UPDATE' AND OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL) THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, after_data, actor_id)
    VALUES (
      'operation_paid', 'operation', NEW.id, 'Operación · ' || COALESCE(contact_label, '?'),
      jsonb_build_object('paid_at', NEW.paid_at, 'precio_venta_usd', NEW.precio_venta_usd),
      NEW.approved_by::text
    );
  END IF;

  -- Status change
  IF (TG_OP = 'UPDATE' AND COALESCE(NEW.status, '') <> COALESCE(OLD.status, '')) THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, after_data)
    VALUES (
      'operation_status_changed', 'operation', NEW.id, 'Operación · ' || COALESCE(contact_label, '?'),
      jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_operations ON public.operations;
CREATE TRIGGER trg_audit_operations
AFTER INSERT OR UPDATE ON public.operations
FOR EACH ROW EXECUTE FUNCTION fn_audit_operations();

-- Trigger para property_negotiations
CREATE OR REPLACE FUNCTION fn_audit_negotiations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, after_data, actor_id)
    VALUES (
      'negotiation_started', 'negotiation', NEW.id, 'Negociación',
      jsonb_build_object('status', NEW.status, 'property_id', NEW.property_id, 'contact_id', NEW.contact_id),
      NEW.agent_id::text
    );
  ELSIF TG_OP = 'UPDATE' AND COALESCE(NEW.status, '') <> COALESCE(OLD.status, '') THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, after_data, context, actor_id)
    VALUES (
      CASE NEW.status WHEN 'caida' THEN 'negotiation_lost' WHEN 'cerrada' THEN 'negotiation_won' ELSE 'negotiation_changed' END,
      'negotiation', NEW.id, 'Negociación',
      jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status),
      NEW.closed_reason,
      NEW.agent_id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_negotiations ON public.property_negotiations;
CREATE TRIGGER trg_audit_negotiations
AFTER INSERT OR UPDATE ON public.property_negotiations
FOR EACH ROW EXECUTE FUNCTION fn_audit_negotiations();

-- Vista enriquecida: une audit_log con names de actor para UI
CREATE OR REPLACE VIEW public.v_audit_log AS
SELECT
  al.id, al.occurred_at, al.actor_id,
  COALESCE(al.actor_label, a.name) AS actor_name,
  al.action, al.entity_type, al.entity_id, al.entity_label,
  al.before_data, al.after_data, al.context
FROM public.audit_log al
LEFT JOIN public.agents a ON a.id::text = al.actor_id
ORDER BY al.occurred_at DESC;
