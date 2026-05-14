-- ════════════════════════════════════════════════════════════════════════════
-- Permitir que vendedores creen contacts (walk-ins / referidos)
-- ════════════════════════════════════════════════════════════════════════════
-- Caso de uso: alguien entra al local en Corrientes 2070 o Alem y Garay,
-- habla con un vendedor, y el vendedor lo carga al CRM como contact propio.
-- Igual con referidos: un amigo nos pasa un contacto.
--
-- Policy nueva: agent puede INSERT en contacts solo si el assigned_to es él
-- mismo (no puede meter leads para otros — Leti maneja la reasignación si hace falta).
-- ════════════════════════════════════════════════════════════════════════════

CREATE POLICY "contacts_agent_insert" ON contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT is_admin() AND assigned_to = current_agent_id()::text
  );
