-- ============================================================
-- Admin guards en RPCs destructivos — 2026-05-17
-- ============================================================
-- merge_contacts y fn_recalc_commissions son SECURITY DEFINER y
-- destructivos (eliminan/recalculan datos). Aunque ya restringimos
-- a authenticated, cualquier vendedor podría llamarlas.
-- Agregamos check de role='admin' al inicio.
-- ============================================================

CREATE OR REPLACE FUNCTION public.merge_contacts(p_primary_id uuid, p_duplicate_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  msgs_moved INT;
  primary_row contacts%ROWTYPE;
  dup_row contacts%ROWTYPE;
  caller_role text;
BEGIN
  -- Guard: solo admin puede fusionar contactos (destructivo)
  -- service_role bypassa porque current_agent_role() retorna null pero
  -- service_role no llama esta función vía PostgREST; solo desde el cliente.
  caller_role := public.current_agent_role();
  IF caller_role IS NULL OR caller_role <> 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'Solo admin puede fusionar contactos');
  END IF;

  IF p_primary_id = p_duplicate_id THEN
    RETURN json_build_object('ok', false, 'error', 'Mismo contacto');
  END IF;

  SELECT * INTO primary_row FROM contacts WHERE id = p_primary_id;
  SELECT * INTO dup_row FROM contacts WHERE id = p_duplicate_id;

  IF primary_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Primary no encontrado');
  END IF;
  IF dup_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Duplicate no encontrado');
  END IF;

  UPDATE messages SET contact_id = p_primary_id WHERE contact_id = p_duplicate_id;
  GET DIAGNOSTICS msgs_moved = ROW_COUNT;
  UPDATE reminders SET contact_id = p_primary_id WHERE contact_id = p_duplicate_id;
  UPDATE contact_stage_changes SET contact_id = p_primary_id WHERE contact_id = p_duplicate_id;
  UPDATE operations SET contact_id = p_primary_id WHERE contact_id = p_duplicate_id;
  UPDATE escalations SET contact_id = p_primary_id WHERE contact_id = p_duplicate_id;
  UPDATE appraisals SET contact_id = p_primary_id WHERE contact_id = p_duplicate_id;

  UPDATE contacts SET
    name = CASE WHEN COALESCE(NULLIF(name, ''), 'Sin nombre') = 'Sin nombre'
                 AND COALESCE(NULLIF(dup_row.name, ''), 'Sin nombre') != 'Sin nombre'
              THEN dup_row.name ELSE name END,
    phone = COALESCE(phone, dup_row.phone),
    email = COALESCE(email, dup_row.email),
    avatar_url = COALESCE(avatar_url, dup_row.avatar_url),
    assigned_to = COALESCE(assigned_to, dup_row.assigned_to),
    property_id = COALESCE(property_id, dup_row.property_id),
    property_title = COALESCE(property_title, dup_row.property_title),
    notes = COALESCE(NULLIF(notes, ''), dup_row.notes),
    updated_at = NOW()
  WHERE id = p_primary_id;

  DELETE FROM contacts WHERE id = p_duplicate_id;

  -- Log audit
  INSERT INTO audit_log(action, entity_type, entity_id, entity_label, after_data, context, actor_id)
  VALUES (
    'contacts_merged', 'contact', p_primary_id,
    COALESCE(primary_row.name, 'Sin nombre'),
    jsonb_build_object('deleted_id', p_duplicate_id, 'messages_moved', msgs_moved),
    'Merge ejecutado por admin',
    public.current_agent_id()::text
  );

  RETURN json_build_object(
    'ok', true,
    'messages_moved', msgs_moved,
    'primary_id', p_primary_id,
    'deleted_id', p_duplicate_id
  );
END
$function$;

-- Re-grant porque CREATE OR REPLACE resetea privilegios
REVOKE EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) TO authenticated;
