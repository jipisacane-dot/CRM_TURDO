-- ============================================================
-- Finanzas personales de Lety + por local — 2026-05-18
-- ============================================================
-- Una sola tabla finance_movements para registrar:
--   - Gastos personales de Lety (scope='personal')
--   - Ingresos/egresos por local (scope='branch', scope_id='corrientes'|'alem')
--
-- Cada movimiento guarda monto en moneda original + monto convertido a USD
-- (con la cotización dólar blue del momento, así el histórico no se distorsiona
-- cuando suba/baje el blue).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.finance_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: 'personal' (gastos de Lety) o 'branch' (ingresos/egresos del local)
  scope text NOT NULL CHECK (scope IN ('personal', 'branch')),
  scope_id text NOT NULL,  -- 'leticia' para personal; 'corrientes'/'alem' para branch

  -- Tipo y categoría
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  category text NOT NULL,

  -- Montos
  amount_original numeric(14,2) NOT NULL CHECK (amount_original >= 0),
  currency_original text NOT NULL CHECK (currency_original IN ('ARS', 'USD')),
  amount_usd numeric(14,2) NOT NULL CHECK (amount_usd >= 0),
  blue_rate numeric(10,2),  -- cotización usada (null si ya estaba en USD)

  -- Metadata
  description text,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES agents(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_movements_scope_date_idx
  ON public.finance_movements (scope, scope_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS finance_movements_category_idx
  ON public.finance_movements (category);
CREATE INDEX IF NOT EXISTS finance_movements_date_idx
  ON public.finance_movements (movement_date DESC);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.fn_finance_movements_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_finance_movements_touch ON public.finance_movements;
CREATE TRIGGER trg_finance_movements_touch
BEFORE UPDATE ON public.finance_movements
FOR EACH ROW EXECUTE FUNCTION public.fn_finance_movements_touch();

-- ──────────────────────────────────────────────────────
-- RLS — solo admin (Lety) puede leer/escribir
-- Las finanzas personales son privadas, los datos de locales son sensibles.
-- ──────────────────────────────────────────────────────
ALTER TABLE public.finance_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_movements_admin_all ON public.finance_movements;
CREATE POLICY finance_movements_admin_all ON public.finance_movements
  FOR ALL TO authenticated
  USING (public.current_agent_role() = 'admin')
  WITH CHECK (public.current_agent_role() = 'admin');

-- ──────────────────────────────────────────────────────
-- Tabla cache para cotización dólar blue (evita pegar a la API a cada request)
-- ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blue_rate_cache (
  id int PRIMARY KEY DEFAULT 1,
  compra numeric(10,2) NOT NULL,
  venta numeric(10,2) NOT NULL,
  promedio numeric(10,2) GENERATED ALWAYS AS ((compra + venta) / 2) STORED,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  source_date timestamptz,
  CHECK (id = 1)  -- una sola fila singleton
);

ALTER TABLE public.blue_rate_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blue_rate_cache_read ON public.blue_rate_cache;
CREATE POLICY blue_rate_cache_read ON public.blue_rate_cache
  FOR SELECT TO authenticated USING (true);

-- Seed inicial (se actualizará con el primer fetch)
INSERT INTO public.blue_rate_cache(id, compra, venta, source_date)
VALUES (1, 1200, 1220, now())
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────
-- Vista materializada para totales mensuales (rendimiento dashboard)
-- ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.finance_monthly_totals AS
SELECT
  scope,
  scope_id,
  type,
  date_trunc('month', movement_date)::date AS month,
  COUNT(*) AS movements,
  SUM(amount_usd) AS total_usd,
  SUM(CASE WHEN currency_original = 'ARS' THEN amount_original ELSE 0 END) AS total_ars_original
FROM public.finance_movements
GROUP BY scope, scope_id, type, date_trunc('month', movement_date);

GRANT SELECT ON public.finance_monthly_totals TO authenticated;
