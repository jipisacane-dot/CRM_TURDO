-- Soporte de moneda en expenses: Leti paga alquileres y comisiones en USD,
-- el resto en ARS. Hasta ahora expenses.amount_ars era el único monto. Esto:
--   1. agrega columna currency ('ARS' default | 'USD')
--   2. agrega amount_usd (opcional, para tracking del monto original en USD
--      cuando currency='USD'; la conversión a ARS se sigue guardando en
--      amount_ars usando el blue rate del día, así los reportes existentes
--      que suman amount_ars siguen funcionando sin tocar)
--
-- Migración no destructiva: las filas existentes quedan con currency='ARS' y
-- amount_usd=null, que es el comportamiento previo.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ARS'
    CHECK (currency IN ('ARS', 'USD')),
  ADD COLUMN IF NOT EXISTS amount_usd numeric(14, 2);

-- Índice para queries de gastos en USD (cuando reporten por moneda original)
CREATE INDEX IF NOT EXISTS idx_expenses_currency ON expenses(currency)
  WHERE currency = 'USD';
