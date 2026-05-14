-- ════════════════════════════════════════════════════════════════════════════
-- Performance: indexes faltantes
-- ════════════════════════════════════════════════════════════════════════════
-- CRÍTICO: agents.auth_user_id se usa en current_agent_id() y is_admin(),
-- que se ejecutan en CADA query con RLS. Sin index, Seq Scan permanente.
--
-- Resto: indexes compuestos para las views más usadas que actualmente
-- hacen Seq Scan en contacts/messages/operations/commissions.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. CRÍTICO: agents.auth_user_id (usado en TODAS las policies RLS)
CREATE INDEX IF NOT EXISTS idx_agents_auth_user_id
  ON agents(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- 2. messages compuesto: para v_response_time y queries que filtran direction
CREATE INDEX IF NOT EXISTS idx_messages_contact_direction_created
  ON messages(contact_id, direction, created_at);

-- 3. messages por created_at + direction (para conteos por canal/periodo)
CREATE INDEX IF NOT EXISTS idx_messages_created_direction
  ON messages(created_at DESC, direction);

-- 4. messages.read no-leídos (para unread count en frontend)
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON messages(contact_id, read)
  WHERE direction = 'in' AND read = false;

-- 5. commissions compuesto: agent + mes + active (para v_my_commissions_monthly)
CREATE INDEX IF NOT EXISTS idx_commissions_agent_mes_active
  ON commissions(agent_id, mes_liquidacion, active);

-- 6. operations compuesto: vendedor + approval (para listings y aprobaciones pendientes)
CREATE INDEX IF NOT EXISTS idx_operations_vendedor_approval
  ON operations(vendedor_id, approval_status);

-- 7. contacts.current_stage_key + assigned_to (para vistas por etapa)
--    (ya existe idx_contacts_stage_agent (assigned_to, current_stage_key) que sirve)

-- 8. property_negotiations expanded: para vistas y dashboards
CREATE INDEX IF NOT EXISTS idx_negotiations_status_created
  ON property_negotiations(status, created_at DESC);

-- 9. reminders due (para query de listDue)
CREATE INDEX IF NOT EXISTS idx_reminders_due_pending
  ON reminders(due_at)
  WHERE done = false;

-- 10. contact_stage_changes recent (para timeline de un contacto)
CREATE INDEX IF NOT EXISTS idx_stage_changes_recent
  ON contact_stage_changes(contact_id, changed_at DESC);

-- 11. Statistics update para que el planner conozca los datos
ANALYZE agents;
ANALYZE contacts;
ANALYZE messages;
ANALYZE operations;
ANALYZE commissions;
ANALYZE property_negotiations;
ANALYZE reminders;
