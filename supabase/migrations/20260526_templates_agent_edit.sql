-- Permite a los agentes editar las templates que ellos crearon, ademas de los
-- admins. Antes la policy templates_admin_write bloqueaba toda escritura no-admin
-- (Tomy reporto "no deja modificar plantillas").
--
-- Reglas finales:
--   INSERT: cualquier usuario autenticado (admin o agent) puede crear
--   UPDATE/DELETE: admin O (created_by guarda el agents.id, hay que linkear via
--                  agents.auth_user_id = auth.uid() porque auth.uid() devuelve
--                  el id de auth.users, NO el id de agents)
--
-- Templates "globales" (sin agent_id especifico) creadas por admin solo el admin
-- las puede modificar. Templates creadas por un agent quedan editables por el.

-- Borrar la policy vieja restrictiva (solo admin)
drop policy if exists templates_admin_write on public.message_templates;

-- Insert: cualquier usuario autenticado
drop policy if exists templates_insert_authenticated on public.message_templates;
create policy templates_insert_authenticated on public.message_templates
for insert
to authenticated
with check (auth.uid() is not null);

-- Update: admin o creador (matchea agents.id <- agents.auth_user_id <- auth.uid())
drop policy if exists templates_update_owner_or_admin on public.message_templates;
create policy templates_update_owner_or_admin on public.message_templates
for update
to authenticated
using (
  is_admin() or
  created_by IN (SELECT id::text FROM agents WHERE auth_user_id = auth.uid())
)
with check (
  is_admin() or
  created_by IN (SELECT id::text FROM agents WHERE auth_user_id = auth.uid())
);

-- Delete: admin o creador
drop policy if exists templates_delete_owner_or_admin on public.message_templates;
create policy templates_delete_owner_or_admin on public.message_templates
for delete
to authenticated
using (
  is_admin() or
  created_by IN (SELECT id::text FROM agents WHERE auth_user_id = auth.uid())
);
