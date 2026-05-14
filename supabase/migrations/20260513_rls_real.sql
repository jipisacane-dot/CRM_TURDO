-- ════════════════════════════════════════════════════════════════════════════
-- RLS REAL · Fase 1.5B.4
-- ════════════════════════════════════════════════════════════════════════════
-- Reemplaza las policies "USING true" decorativas por reglas reales basadas
-- en Supabase Auth (auth.uid() → agents.auth_user_id).
--
-- Patrón general:
--   - anon (sin login)        → DENEGADO en TODO (las páginas públicas usan
--                                edge functions con service_role que bypassan RLS).
--   - authenticated admin     → acceso total.
--   - authenticated agent     → solo registros relacionados a su agent_id.
--
-- NOTA sobre tipos: algunas columnas legacy son TEXT (contacts.assigned_to,
-- messages.agent_id, reminders.agent_id, appraisals.agent_id,
-- client_portals.agent_id, push_subscriptions.agent_id, message_templates.agent_id).
-- Cast a TEXT cuando se compara con current_agent_id() (UUID).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Drop policies viejas ────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END$$;

-- ─── 1. AGENTS ────────────────────────────────────────────────────────────
CREATE POLICY "agents_select_auth" ON agents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "agents_write_admin" ON agents
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── 2. CONTACTS (assigned_to es TEXT) ─────────────────────────────────────
-- Vendedores SOLO ven lo asignado por Leti. Los sin asignar son pool de admin —
-- Leti los distribuye, los vendedores no deben verlos hasta que les corresponda.
CREATE POLICY "contacts_admin_all" ON contacts
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "contacts_agent_select" ON contacts
  FOR SELECT TO authenticated
  USING (NOT is_admin() AND assigned_to = current_agent_id()::text);
CREATE POLICY "contacts_agent_update" ON contacts
  FOR UPDATE TO authenticated
  USING (NOT is_admin() AND assigned_to = current_agent_id()::text)
  WITH CHECK (NOT is_admin() AND assigned_to = current_agent_id()::text);

-- ─── 3. MESSAGES (contact_id es UUID, agent_id es TEXT) ────────────────────
CREATE POLICY "messages_admin_all" ON messages
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "messages_agent_select" ON messages
  FOR SELECT TO authenticated
  USING (
    NOT is_admin() AND contact_id IN (
      SELECT id FROM contacts WHERE assigned_to = current_agent_id()::text
    )
  );
CREATE POLICY "messages_agent_insert" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (
    contact_id IN (
      SELECT id FROM contacts WHERE assigned_to = current_agent_id()::text
    )
  );

-- ─── 4. CONTACT_STAGE_CHANGES ──────────────────────────────────────────────
CREATE POLICY "stage_changes_admin_all" ON contact_stage_changes
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "stage_changes_agent" ON contact_stage_changes
  FOR SELECT TO authenticated
  USING (
    NOT is_admin() AND contact_id IN (
      SELECT id FROM contacts WHERE assigned_to = current_agent_id()::text
    )
  );

-- ─── 5. OPERATIONS (vendedor_id, captador_id son UUID) ────────────────────
CREATE POLICY "operations_admin_all" ON operations
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "operations_agent" ON operations
  FOR ALL TO authenticated
  USING (
    NOT is_admin() AND (
      vendedor_id = current_agent_id()
      OR captador_id = current_agent_id()
    )
  )
  WITH CHECK (
    vendedor_id = current_agent_id()
    OR captador_id = current_agent_id()
  );

-- ─── 6. OPERATION_DOCUMENTS y OPERATION_EVENTS ──────────────────────────────
CREATE POLICY "op_docs_admin_all" ON operation_documents
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "op_docs_agent" ON operation_documents
  FOR SELECT TO authenticated
  USING (
    NOT is_admin() AND operation_id IN (
      SELECT id FROM operations WHERE vendedor_id = current_agent_id() OR captador_id = current_agent_id()
    )
  );

CREATE POLICY "op_events_admin_all" ON operation_events
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "op_events_agent" ON operation_events
  FOR SELECT TO authenticated
  USING (
    NOT is_admin() AND operation_id IN (
      SELECT id FROM operations WHERE vendedor_id = current_agent_id() OR captador_id = current_agent_id()
    )
  );

-- ─── 7. COMMISSIONS (agent_id es UUID) ────────────────────────────────────
CREATE POLICY "commissions_admin_all" ON commissions
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "commissions_agent" ON commissions
  FOR SELECT TO authenticated
  USING (NOT is_admin() AND agent_id = current_agent_id());

CREATE POLICY "advances_admin_all" ON commission_advances
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "advances_agent" ON commission_advances
  FOR SELECT TO authenticated
  USING (NOT is_admin() AND agent_id = current_agent_id());

-- ─── 8. FINANCIEROS — admin solo ──────────────────────────────────────────
CREATE POLICY "expenses_admin_all" ON expenses
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "incomes_admin_all" ON incomes
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "expirations_admin_all" ON expirations
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "payroll_admin_all" ON payroll_runs
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── 9. PROPERTIES ────────────────────────────────────────────────────────
CREATE POLICY "properties_select_all" ON properties
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "properties_admin_write" ON properties
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "properties_agent_insert" ON properties
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "property_photos_select_all" ON property_photos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "property_photos_admin_write" ON property_photos
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "property_photos_agent_insert" ON property_photos
  FOR INSERT TO authenticated WITH CHECK (true);

-- ─── 10. PROPERTY_NEGOTIATIONS (agent_id es UUID) ──────────────────────────
CREATE POLICY "negotiations_admin_all" ON property_negotiations
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "negotiations_agent" ON property_negotiations
  FOR ALL TO authenticated
  USING (NOT is_admin() AND agent_id = current_agent_id())
  WITH CHECK (agent_id = current_agent_id());

-- ─── 11. REMINDERS (agent_id es TEXT) ──────────────────────────────────────
CREATE POLICY "reminders_admin_all" ON reminders
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "reminders_agent" ON reminders
  FOR ALL TO authenticated
  USING (NOT is_admin() AND agent_id = current_agent_id()::text)
  WITH CHECK (agent_id = current_agent_id()::text);

-- ─── 12. ESCALATIONS — admin solo ─────────────────────────────────────────
CREATE POLICY "escalations_admin_all" ON escalations
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── 13. NPS_SURVEYS — admin solo ─────────────────────────────────────────
CREATE POLICY "nps_admin_all" ON nps_surveys
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── 14. PIPELINE_STAGES — todos read ─────────────────────────────────────
CREATE POLICY "pipeline_stages_select_all" ON pipeline_stages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "pipeline_stages_admin_write" ON pipeline_stages
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── 15. MESSAGE_TEMPLATES (agent_id es TEXT) ─────────────────────────────
CREATE POLICY "templates_select_all" ON message_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "templates_admin_write" ON message_templates
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── 16. NOTIFICATION_RULES — admin solo ──────────────────────────────────
CREATE POLICY "notification_rules_admin_all" ON notification_rules
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── 17. AGENT_CAPACITY (agent_id es UUID) ────────────────────────────────
CREATE POLICY "agent_capacity_admin_all" ON agent_capacity
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "assignment_config_admin_all" ON assignment_config
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── 18. ASSISTANT_MEMORIES — admin solo ──────────────────────────────────
CREATE POLICY "memories_admin_all" ON assistant_memories
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── 19. PUSH_SUBSCRIPTIONS (agent_id es TEXT) ────────────────────────────
CREATE POLICY "push_owner" ON push_subscriptions
  FOR ALL TO authenticated
  USING (agent_id = current_agent_id()::text OR is_admin())
  WITH CHECK (agent_id = current_agent_id()::text OR is_admin());

-- ─── 20. APPRAISALS (agent_id es TEXT) ────────────────────────────────────
CREATE POLICY "appraisals_admin_all" ON appraisals
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "appraisals_agent" ON appraisals
  FOR ALL TO authenticated
  USING (NOT is_admin() AND agent_id = current_agent_id()::text)
  WITH CHECK (agent_id = current_agent_id()::text);

-- ─── 21. CLIENT_PORTALS (agent_id es TEXT) ────────────────────────────────
CREATE POLICY "portals_admin_all" ON client_portals
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "portals_agent" ON client_portals
  FOR SELECT TO authenticated
  USING (
    NOT is_admin() AND contact_id IN (
      SELECT id FROM contacts WHERE assigned_to = current_agent_id()::text
    )
  );

-- ─── 22. SCRIPT_QUEUE (requested_by es UUID, no agent_id) ──────────────────
CREATE POLICY "scripts_admin_all" ON script_queue
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "scripts_agent" ON script_queue
  FOR ALL TO authenticated
  USING (NOT is_admin() AND requested_by = current_agent_id())
  WITH CHECK (requested_by = current_agent_id());

-- ─── 23. Tablas internas — deny authenticated también ─────────────────────
CREATE POLICY "audit_log_deny_auth" ON audit_log
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "lead_preferences_deny_auth" ON lead_preferences
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "portal_events_deny_auth" ON portal_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "property_lead_matches_deny_auth" ON property_lead_matches
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "property_status_history_deny_auth" ON property_status_history
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "property_price_history_deny_auth" ON property_price_history
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ════════════════════════════════════════════════════════════════════════════
-- Resultado:
--   - anon: 0 acceso (todas las policies son TO authenticated; default DENY)
--   - authenticated admin: total
--   - authenticated agent: solo sus registros
--   - service_role (edge functions): bypassa RLS automáticamente
-- ════════════════════════════════════════════════════════════════════════════
