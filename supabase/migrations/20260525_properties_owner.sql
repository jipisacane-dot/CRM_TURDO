-- Leti carga una propiedad principalmente con: dirección + piso + letra +
-- propietario. Hasta ahora no había campos de propietario en properties
-- (solo en operations.propietario_nombre/telefono al momento de la venta).
-- Esto permite cargarlos directamente al consignar la propiedad.
--
-- Aplicado a producción 25/05/2026 vía Management API.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS owner_phone text;
