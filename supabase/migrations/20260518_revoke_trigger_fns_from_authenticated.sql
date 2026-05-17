-- ============================================================
-- Revoke EXECUTE de authenticated en trigger functions — 2026-05-18
-- ============================================================
-- Supabase advisor flagged "Signed-In Users Can Execute SECURITY DEFINER Function".
-- Las TRIGGER functions no necesitan ser ejecutables vía PostgREST RPC —
-- se ejecutan solo por el motor cuando dispara el trigger.
-- Revocar de authenticated cierra la posibilidad de invocación directa
-- sin afectar el funcionamiento de los triggers (que corren como SECURITY DEFINER).
-- ============================================================

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
      AND p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated, anon, public',
      r.proname, r.args
    );
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────
-- Funciones que NO son triggers pero son internas (no se llaman desde el cliente).
-- Las revocamos también de authenticated:
--   - fn_pick_next_agent: solo se llama desde fn_auto_assign_contact (trigger)
--   - fn_sync_commissions_paid: solo se llama desde fn_operations_recalc
-- ──────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_pick_next_agent(text, text) FROM authenticated, anon, public;

-- check_rate_limit: llamado desde edge fns con service_role (bypassea RLS).
-- Authenticated NUNCA debería llamarlo directo.
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) FROM authenticated, anon, public;

-- find_or_create_contact: solo se llama desde webhooks (service_role).
-- Authenticated podría crear contactos arbitrariamente saltando triggers.
DO $$
DECLARE
  fn_sig text;
BEGIN
  FOR fn_sig IN
    SELECT pg_catalog.pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'find_or_create_contact'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.find_or_create_contact(%s) FROM authenticated, anon, public', fn_sig);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────
-- Estas SÍ se mantienen ejecutables por authenticated (excepciones justificadas):
--   - is_admin(), current_agent_id(), current_agent_role():
--       necesarias en evaluación de policies RLS por el caller.
--       Retornan info del propio usuario, no de otros (benignas).
--   - merge_contacts: guard interno chequea current_agent_role()='admin'
--   - fn_recalc_commissions: admin lo llama, low risk
--   - fn_auto_assign_contact(uuid), fn_score_match, fn_upsert_match,
--     fn_detect_duplicate(uuid), normalize_phone: usadas desde el cliente
--       en flows de pipeline y matching
-- ──────────────────────────────────────────────────────
