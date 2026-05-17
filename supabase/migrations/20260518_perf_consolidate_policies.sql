-- ============================================================
-- Perf: consolidar Multiple Permissive Policies + drop duplicate indexes
-- 2026-05-18
-- ============================================================
-- Cada query a estas tablas evalúa AMBAS policies (admin + agent).
-- Consolidar en una sola con OR mejora performance (1 eval en vez de 2)
-- y limpia los warnings del Performance Advisor.
--
-- Lógica conservada exacta:
--   - admin: ve/edita todo
--   - agent: solo sus propios registros
-- ============================================================

-- ──────────────────────────────────────────────────────
-- 1. appraisals
-- ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS appraisals_admin_all ON public.appraisals;
DROP POLICY IF EXISTS appraisals_agent ON public.appraisals;
CREATE POLICY appraisals_access ON public.appraisals
  FOR ALL TO authenticated
  USING (is_admin() OR (agent_id = (current_agent_id())::text))
  WITH CHECK (is_admin() OR (agent_id = (current_agent_id())::text));

-- ──────────────────────────────────────────────────────
-- 2. operations
-- ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS operations_admin_all ON public.operations;
DROP POLICY IF EXISTS operations_agent ON public.operations;
CREATE POLICY operations_access ON public.operations
  FOR ALL TO authenticated
  USING (is_admin() OR (vendedor_id = current_agent_id()) OR (captador_id = current_agent_id()))
  WITH CHECK (is_admin() OR (vendedor_id = current_agent_id()) OR (captador_id = current_agent_id()));

-- ──────────────────────────────────────────────────────
-- 3. property_negotiations
-- ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS negotiations_admin_all ON public.property_negotiations;
DROP POLICY IF EXISTS negotiations_agent ON public.property_negotiations;
CREATE POLICY negotiations_access ON public.property_negotiations
  FOR ALL TO authenticated
  USING (is_admin() OR (agent_id = current_agent_id()))
  WITH CHECK (is_admin() OR (agent_id = current_agent_id()));

-- ──────────────────────────────────────────────────────
-- 4. reminders
-- ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS reminders_admin_all ON public.reminders;
DROP POLICY IF EXISTS reminders_agent ON public.reminders;
CREATE POLICY reminders_access ON public.reminders
  FOR ALL TO authenticated
  USING (is_admin() OR (agent_id = (current_agent_id())::text))
  WITH CHECK (is_admin() OR (agent_id = (current_agent_id())::text));

-- ──────────────────────────────────────────────────────
-- 5. script_queue
-- ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS scripts_admin_all ON public.script_queue;
DROP POLICY IF EXISTS scripts_agent ON public.script_queue;
CREATE POLICY scripts_access ON public.script_queue
  FOR ALL TO authenticated
  USING (is_admin() OR (requested_by = current_agent_id()))
  WITH CHECK (is_admin() OR (requested_by = current_agent_id()));

-- ============================================================
-- Drop duplicate indexes
-- ============================================================
-- client_portals: token_idx duplica el unique constraint token_key
DROP INDEX IF EXISTS public.client_portals_token_idx;

-- contact_stage_changes: los 2 indices cubren la misma columna principal
DROP INDEX IF EXISTS public.idx_stage_changes_recent;

-- escalations: los 2 cubren el mismo prefijo de columnas
DROP INDEX IF EXISTS public.escalations_lookup_idx;

-- script_queue: tracking_code_key (unique) y tracking_idx redundantes
DROP INDEX IF EXISTS public.idx_script_queue_tracking;
