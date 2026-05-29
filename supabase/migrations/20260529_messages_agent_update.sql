-- Bug (reportado por Tomi 29/05/2026): los vendedores no pueden marcar mensajes
-- como leídos. Un chat (típicamente archivado) queda "no leído" para siempre
-- aunque el vendedor lo abra.
--
-- Causa: la tabla `messages` tenía policies de SELECT e INSERT para agentes, pero
-- NINGUNA de UPDATE (solo admin via messages_admin_all). markChatRead corre
-- UPDATE messages SET read=true → RLS lo filtra a 0 filas sin error → al
-- refrescar, el mensaje vuelve a aparecer como no leído.
--
-- Fix: policy de UPDATE para agentes sobre los mensajes de SUS contactos
-- asignados (mismo criterio que messages_agent_select / messages_agent_insert).

CREATE POLICY messages_agent_update ON public.messages
  FOR UPDATE
  USING (
    (NOT is_admin()) AND (contact_id IN (
      SELECT contacts.id FROM contacts
      WHERE contacts.assigned_to = (current_agent_id())::text
    ))
  )
  WITH CHECK (
    (NOT is_admin()) AND (contact_id IN (
      SELECT contacts.id FROM contacts
      WHERE contacts.assigned_to = (current_agent_id())::text
    ))
  );
