-- ============================================================
-- Rate limit infra — 2026-05-17
-- ============================================================
-- Tabla + función atómica para rate limit basado en Postgres.
-- Cada edge function llama check_rate_limit() antes de procesar.
-- Si retorna false → 429 Too Many Requests.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  hits int NOT NULL DEFAULT 0,
  blocked_until timestamptz
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON public.rate_limits(window_start);

-- ──────────────────────────────────────────────────────
-- check_rate_limit: chequea + incrementa atómicamente.
-- Retorna true si la request puede proceder, false si está rate-limited.
--
-- Args:
--   p_key: identificador único (ej: 'assistant-chat:1.2.3.4' o 'appraise:user-uuid')
--   p_max: hits máximos en la ventana
--   p_window_seconds: tamaño de ventana en segundos
--
-- Comportamiento:
--   - Si no hay registro → crea uno con hits=1, retorna true
--   - Si la ventana ya pasó → resetea contador a 1, retorna true
--   - Si hits < p_max en la ventana → incrementa, retorna true
--   - Si hits >= p_max → retorna false (bloqueado hasta fin de ventana)
-- ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_max int,
  p_window_seconds int
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_hits int;
BEGIN
  -- UPSERT atómico
  INSERT INTO rate_limits(key, window_start, hits)
  VALUES (p_key, v_now, 1)
  ON CONFLICT (key) DO UPDATE
    SET hits = CASE
        WHEN rate_limits.window_start + (p_window_seconds || ' seconds')::interval < v_now
          THEN 1
        ELSE rate_limits.hits + 1
      END,
      window_start = CASE
        WHEN rate_limits.window_start + (p_window_seconds || ' seconds')::interval < v_now
          THEN v_now
        ELSE rate_limits.window_start
      END
  RETURNING hits, window_start INTO v_hits, v_window_start;

  -- Bloqueado si superó el max en esta ventana
  IF v_hits > p_max THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, int, int) TO authenticated, service_role;

-- ──────────────────────────────────────────────────────
-- Cleanup: borrar registros viejos (>24h) automáticamente
-- ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_rate_limits_cleanup()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM rate_limits
  WHERE window_start < now() - interval '24 hours'
    AND (blocked_until IS NULL OR blocked_until < now());
$$;

REVOKE EXECUTE ON FUNCTION public.fn_rate_limits_cleanup() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rate_limits_cleanup() TO service_role;

-- Programar cleanup cada hora via pg_cron
DO $$
BEGIN
  PERFORM cron.unschedule('rate-limits-cleanup');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'rate-limits-cleanup',
  '0 * * * *',
  'SELECT public.fn_rate_limits_cleanup()'
);

-- RLS — service_role bypassea, authenticated no debe leer la tabla
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_limits_no_access ON public.rate_limits;
CREATE POLICY rate_limits_no_access ON public.rate_limits FOR ALL TO authenticated USING (false) WITH CHECK (false);
