-- ============================================================
-- Audit triggers extendidos — 2026-05-17
-- ============================================================
-- Agrega tracking automático a tablas sensibles que no tenían:
-- - commissions: cambios de monto, pago, status
-- - agents: cambios de role/active (escalación de privilegios)
-- - properties: cambios de precio o publicación
-- - DELETE en tablas críticas (operations, commissions, properties, contacts)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. COMMISSIONS — cambios sensibles
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_commissions()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  agent_label text;
BEGIN
  SELECT name INTO agent_label FROM agents WHERE id = COALESCE(NEW.agent_id, OLD.agent_id);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, after_data, actor_id)
    VALUES (
      'commission_created', 'commission', NEW.id,
      'Comisión · ' || COALESCE(agent_label, '?'),
      jsonb_build_object('amount_usd', NEW.amount_usd, 'status', NEW.status, 'operation_id', NEW.operation_id),
      NEW.agent_id::text
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Solo loguear si cambia algo significativo (monto, status, pago)
    IF (COALESCE(NEW.amount_usd, 0) <> COALESCE(OLD.amount_usd, 0)
        OR COALESCE(NEW.status, '') <> COALESCE(OLD.status, '')
        OR COALESCE(NEW.paid_at::text, '') <> COALESCE(OLD.paid_at::text, '')) THEN
      INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, after_data, actor_id)
      VALUES (
        'commission_updated', 'commission', NEW.id,
        'Comisión · ' || COALESCE(agent_label, '?'),
        jsonb_build_object('amount_usd', OLD.amount_usd, 'status', OLD.status, 'paid_at', OLD.paid_at),
        jsonb_build_object('amount_usd', NEW.amount_usd, 'status', NEW.status, 'paid_at', NEW.paid_at),
        NEW.agent_id::text
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, actor_id, context)
    VALUES (
      'commission_deleted', 'commission', OLD.id,
      'Comisión · ' || COALESCE(agent_label, '?'),
      jsonb_build_object('amount_usd', OLD.amount_usd, 'status', OLD.status, 'operation_id', OLD.operation_id),
      OLD.agent_id::text,
      'DELETION — verificar si fue intencional'
    );
    RETURN OLD;
  END IF;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_commissions ON commissions;
CREATE TRIGGER trg_audit_commissions
AFTER INSERT OR UPDATE OR DELETE ON commissions
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_commissions();

-- ─────────────────────────────────────────────────────────────
-- 2. AGENTS — escalación de privilegios / cambio de role / desactivación
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_agents()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, after_data)
    VALUES (
      'agent_created', 'agent', NEW.id, NEW.name,
      jsonb_build_object('email', NEW.email, 'role', NEW.role, 'branch', NEW.branch, 'active', NEW.active)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Loguear cambios sensibles: role, active, email
    IF (COALESCE(NEW.role, '') <> COALESCE(OLD.role, '')
        OR COALESCE(NEW.active, false) <> COALESCE(OLD.active, false)
        OR COALESCE(NEW.email, '') <> COALESCE(OLD.email, '')) THEN
      INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, after_data, context)
      VALUES (
        CASE
          WHEN COALESCE(NEW.role, '') <> COALESCE(OLD.role, '') THEN 'agent_role_changed'
          WHEN NEW.active = false AND OLD.active = true THEN 'agent_deactivated'
          WHEN NEW.active = true AND OLD.active = false THEN 'agent_activated'
          ELSE 'agent_updated'
        END,
        'agent', NEW.id, NEW.name,
        jsonb_build_object('role', OLD.role, 'active', OLD.active, 'email', OLD.email),
        jsonb_build_object('role', NEW.role, 'active', NEW.active, 'email', NEW.email),
        'Cambio sensible en agent'
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, context)
    VALUES (
      'agent_deleted', 'agent', OLD.id, OLD.name,
      jsonb_build_object('email', OLD.email, 'role', OLD.role, 'branch', OLD.branch),
      'DELETION — verificar si fue intencional. Considerar usar active=false en su lugar.'
    );
    RETURN OLD;
  END IF;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_agents ON agents;
CREATE TRIGGER trg_audit_agents
AFTER INSERT OR UPDATE OR DELETE ON agents
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_agents();

-- ─────────────────────────────────────────────────────────────
-- 3. PROPERTIES — cambios de precio, status, publicación
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_properties()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prop_label text;
BEGIN
  prop_label := COALESCE(NEW.title, OLD.title, '?') || ' (' || COALESCE(NEW.address, OLD.address, '') || ')';

  IF TG_OP = 'UPDATE' THEN
    -- Cambio de precio
    IF COALESCE(NEW.price_usd, 0) <> COALESCE(OLD.price_usd, 0) THEN
      INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, after_data)
      VALUES (
        'property_price_changed', 'property', NEW.id, prop_label,
        jsonb_build_object('price_usd', OLD.price_usd),
        jsonb_build_object('price_usd', NEW.price_usd)
      );
    END IF;
    -- Cambio de status (publicada / pausada / vendida)
    IF COALESCE(NEW.status, '') <> COALESCE(OLD.status, '') THEN
      INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, after_data)
      VALUES (
        'property_status_changed', 'property', NEW.id, prop_label,
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', NEW.status)
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, context)
    VALUES (
      'property_deleted', 'property', OLD.id, prop_label,
      jsonb_build_object('price_usd', OLD.price_usd, 'status', OLD.status, 'address', OLD.address),
      'DELETION — propiedad eliminada permanentemente'
    );
    RETURN OLD;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_properties ON properties;
CREATE TRIGGER trg_audit_properties
AFTER UPDATE OR DELETE ON properties
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_properties();

-- ─────────────────────────────────────────────────────────────
-- 4. CONTACTS DELETE (los UPDATE ya tienen trigger)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_contacts_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(action, entity_type, entity_id, entity_label, before_data, context)
  VALUES (
    'contact_deleted', 'contact', OLD.id, OLD.name,
    jsonb_build_object(
      'phone', OLD.phone, 'email', OLD.email, 'channel', OLD.channel,
      'status', OLD.status, 'assigned_to', OLD.assigned_to
    ),
    'DELETION — contacto eliminado permanentemente (Ley 25.326 right to be forgotten)'
  );
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_contacts_delete ON contacts;
CREATE TRIGGER trg_audit_contacts_delete
AFTER DELETE ON contacts
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_contacts_delete();
