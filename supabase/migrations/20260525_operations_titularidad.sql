-- Leti cierra una operación recién cuando hace el cambio de titularidad de
-- luz/gas a nombre del nuevo dueño. Hasta ese momento sigue siendo "trabajo
-- en curso" aunque la escritura ya esté firmada. Estos campos permiten marcar
-- ese cierre explícito sin reutilizar los textos libres osse/arba/camuzzi/edea
-- (que siguen sirviendo como notas por servicio).
--
-- Aplicado a producción 25/05/2026 vía Management API.

ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS titularidad_servicios_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS titularidad_servicios_done_at timestamptz;
