-- ============================================================
-- Revoke EXECUTE de anon en RPCs de negocio — 2026-05-17
-- ============================================================
-- Problema: 44 funciones públicas son ejecutables por anon.
-- Las SECURITY DEFINER bypasan RLS, así que anon podría:
--   - merge_contacts: fusionar cualquier par de contactos
--   - fn_recalc_commissions: recalcular comisiones de cualquier vendedor
--   - fn_auto_assign_contact: reasignar contactos
--   - find_or_create_contact: crear contactos masivamente
--
-- Solución: REVOKE EXECUTE FROM anon en TODAS las funciones de negocio,
-- usando enfoque dinámico (no necesitamos conocer cada signature).
-- Mantenemos las "informativas" (current_agent_id, current_agent_role, is_admin)
-- que retornan NULL/false si no hay sesión y son inocuas.
-- ============================================================

-- ──────────────────────────────────────────────────────
-- Whitelist: funciones que SÍ son seguras para anon (informativas)
-- ──────────────────────────────────────────────────────
-- (vacío por ahora — current_agent_id/role/is_admin retornan null para anon,
-- pero no hay razón para que anon las llame; las dejamos solo para authenticated)

-- ──────────────────────────────────────────────────────
-- Revoke dinámico: para CADA función pública con anon EXECUTE → REVOKE
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  identity_args text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
           p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'EXECUTE') = true
  LOOP
    -- Revocar de anon Y de public (en Postgres, public es un pseudo-role del
    -- que cualquier role hereda EXECUTE por default si no se revoca).
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, public',
                   r.proname, r.args);
    RAISE NOTICE 'Revoked: %(%)', r.proname, r.args;
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────
-- Re-grant EXECUTE a authenticated en las funciones que el CRM necesita.
-- Estas se llaman desde el cliente con JWT del agente.
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
      AND p.proname IN (
        'current_agent_id',
        'current_agent_role',
        'is_admin',
        'find_or_create_contact',
        'fn_auto_assign_contact',
        'fn_pick_agent_for_contact',
        'fn_pick_next_agent',
        'fn_score_match',
        'fn_upsert_match',
        'fn_detect_duplicate',
        'merge_contacts',
        'fn_recalc_commissions',
        'normalize_phone'
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',
                   r.proname, r.args);
    RAISE NOTICE 'Granted to authenticated: %(%)', r.proname, r.args;
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────
-- Service role siempre tiene acceso (cron, edge fns) — no necesita re-grant
-- (Supabase configura service_role con BYPASSRLS y SUPERUSER-like)
-- ──────────────────────────────────────────────────────
