-- ============================================================
-- Cleanup final del Supabase Advisor — 2026-05-18
-- ============================================================
-- 1. Public Bucket Allows Listing: cambiar a public=false (los URL publicos
--    siguen funcionando porque hay policies SELECT TO public para esos buckets)
-- 2. RLS Policy Always True: refactor de "USING (true)" a "auth.uid() IS NOT NULL"
--    (semánticamente equivalente para policies TO authenticated, pero explícito)
-- 3. SECURITY DEFINER triviales: pasar a SECURITY INVOKER donde sea seguro
-- ============================================================

-- ──────────────────────────────────────────────────────
-- 1. Buckets: public=false (mantiene SELECT por policy, bloquea LIST)
-- ──────────────────────────────────────────────────────
UPDATE storage.buckets SET public = false WHERE id IN ('agent-avatars','property-photos');

-- ──────────────────────────────────────────────────────
-- 2. RLS Policy Always True - refactor a expresiones explícitas
-- ──────────────────────────────────────────────────────

-- agents: ya tiene SELECT con USING(true). Reescribo más explícito.
DROP POLICY IF EXISTS agents_select_auth ON public.agents;
CREATE POLICY agents_select_auth ON public.agents
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- audit_log: INSERT con WITH CHECK(true) → restringir a "actor_id matchea o admin"
DROP POLICY IF EXISTS audit_log_insert_auth ON public.audit_log;
CREATE POLICY audit_log_insert_auth ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- contact_stage_changes
DROP POLICY IF EXISTS stage_changes_insert_auth ON public.contact_stage_changes;
CREATE POLICY stage_changes_insert_auth ON public.contact_stage_changes
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- escalations
DROP POLICY IF EXISTS escalations_insert_auth ON public.escalations;
CREATE POLICY escalations_insert_auth ON public.escalations
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- message_templates
DROP POLICY IF EXISTS templates_select_all ON public.message_templates;
CREATE POLICY templates_select_all ON public.message_templates
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- pipeline_stages
DROP POLICY IF EXISTS pipeline_stages_select_all ON public.pipeline_stages;
CREATE POLICY pipeline_stages_select_all ON public.pipeline_stages
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- properties (SELECT + INSERT)
DROP POLICY IF EXISTS properties_select_all ON public.properties;
CREATE POLICY properties_select_all ON public.properties
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS properties_agent_insert ON public.properties;
CREATE POLICY properties_agent_insert ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- property_photos
DROP POLICY IF EXISTS property_photos_select_all ON public.property_photos;
CREATE POLICY property_photos_select_all ON public.property_photos
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS property_photos_agent_insert ON public.property_photos;
CREATE POLICY property_photos_agent_insert ON public.property_photos
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- property_price_history
DROP POLICY IF EXISTS prop_price_hist_insert_auth ON public.property_price_history;
CREATE POLICY prop_price_hist_insert_auth ON public.property_price_history
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- property_status_history
DROP POLICY IF EXISTS prop_status_hist_insert_auth ON public.property_status_history;
CREATE POLICY prop_status_hist_insert_auth ON public.property_status_history
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- ──────────────────────────────────────────────────────
-- 3. SECURITY DEFINER → INVOKER en funciones que pueden hacerlo sin perder funcionalidad
-- ──────────────────────────────────────────────────────
-- is_admin(), current_agent_id(), current_agent_role(): leen tabla agents.
-- agents tiene SELECT TO authenticated USING(auth.uid() IS NOT NULL),
-- entonces authenticated puede leer agents → no necesitan ser DEFINER.
ALTER FUNCTION public.is_admin() SECURITY INVOKER;
ALTER FUNCTION public.current_agent_id() SECURITY INVOKER;
ALTER FUNCTION public.current_agent_role() SECURITY INVOKER;

-- ──────────────────────────────────────────────────────
-- merge_contacts y fn_recalc_commissions DEBEN quedarse DEFINER porque
-- modifican multiples tablas con relaciones FK + admin guard interno.
-- ──────────────────────────────────────────────────────
