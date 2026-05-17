-- ============================================================
-- Fix Function Search Path Mutable warnings — 2026-05-18
-- ============================================================
-- Supabase Security Advisor flagged 39 functions sin search_path fijo.
-- Sin SET search_path, un atacante con permisos limitados podría crear
-- objetos en schemas earlier-in-search-path y secuestrar la ejecución.
--
-- Fix: ALTER FUNCTION ... SET search_path = public, pg_catalog
-- (manteniendo public para que las queries internas a la app sigan
-- funcionando, y pg_catalog para que tipos built-in resuelvan).
--
-- Uso enfoque dinámico para no tener que escribir las 39 signatures.
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
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_catalog',
      r.proname, r.args
    );
  END LOOP;
END $$;
