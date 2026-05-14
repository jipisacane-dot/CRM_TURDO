-- ════════════════════════════════════════════════════════════════════════════
-- Security hardening · Fase 1
-- ════════════════════════════════════════════════════════════════════════════
-- Contexto: la app no usa Supabase Auth (sesión es agentId en localStorage).
-- Esta migration NO arregla todo el problema de seguridad, pero:
--   1. Activa RLS en las 13 tablas que faltan (consistencia)
--   2. Cierra duro las tablas que solo se acceden desde edge functions
--      (service_role bypassa RLS, así que las edge fn siguen funcionando)
--   3. Mantiene RLS abierto en las tablas accedidas desde el frontend
--      para no romper la app (refactor real en Fase 1.5)
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Activar RLS donde falta ──────────────────────────────────────────────
ALTER TABLE appraisals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_portals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_preferences       ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_lead_matches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_photos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_queue           ENABLE ROW LEVEL SECURITY;

-- ─── 2. Tablas internas: deny anon completo ──────────────────────────────────
-- service_role bypassa RLS automáticamente, edge functions siguen accediendo.

-- audit_log: nadie lo lee desde frontend
CREATE POLICY "deny_anon" ON audit_log
  FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "deny_authenticated" ON audit_log
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- lead_preferences: solo edge fn infer-lead-preferences escribe; nadie lee desde anon
CREATE POLICY "deny_anon" ON lead_preferences
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- portal_events: solo edge fn track-portal-event escribe
CREATE POLICY "deny_anon" ON portal_events
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- property_lead_matches: solo edge fn match-property-to-leads
CREATE POLICY "deny_anon" ON property_lead_matches
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- property_status_history: trigger DB lo llena, nadie lo lee desde anon
CREATE POLICY "deny_anon" ON property_status_history
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- property_price_history: trigger DB lo llena, nadie lo lee desde anon
CREATE POLICY "deny_anon" ON property_price_history
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- ─── 3. Tablas accedidas desde frontend: open (sin romper la app) ─────────────
-- TODO Fase 1.5: migrar estos accesos a edge functions con validación de sesión

-- appraisals: frontend lee single por id (Appraisals page)
CREATE POLICY "open_for_now" ON appraisals
  FOR ALL USING (true) WITH CHECK (true);

-- client_portals: frontend desactiva portales (services/portals.ts)
CREATE POLICY "open_for_now" ON client_portals
  FOR ALL USING (true) WITH CHECK (true);

-- message_templates: frontend CRUD desde /templates
CREATE POLICY "open_for_now" ON message_templates
  FOR ALL USING (true) WITH CHECK (true);

-- notification_rules: frontend lee/edita desde /notifications (admin)
CREATE POLICY "open_for_now" ON notification_rules
  FOR ALL USING (true) WITH CHECK (true);

-- pipeline_stages: read-only seed config para el frontend (Kanban)
CREATE POLICY "open_read" ON pipeline_stages
  FOR SELECT USING (true);

-- property_photos: frontend CRUD desde PropertyFormModal
CREATE POLICY "open_for_now" ON property_photos
  FOR ALL USING (true) WITH CHECK (true);

-- script_queue: frontend lee/cancela/elimina desde /scripts
CREATE POLICY "open_for_now" ON script_queue
  FOR ALL USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════════
-- Resultado:
--   13 tablas con RLS recién activado
--   6 tablas con acceso anon completamente bloqueado (las internas)
--   7 tablas open hasta Fase 1.5 (refactor a edge functions)
-- ════════════════════════════════════════════════════════════════════════════
