-- Properties v2: convertir tabla en source of truth para reemplazar Tokko.
-- Agrega ~25 campos para ML/ZP/Web, multi-foto, historial de status y precio.

-- 1) Sequence para internal_code (TURDO-0001, 0002...)
CREATE SEQUENCE IF NOT EXISTS property_internal_seq START 1;

-- 2) Extender tabla properties
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS internal_code text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS operation_type text DEFAULT 'venta',
  ADD COLUMN IF NOT EXISTS property_type text DEFAULT 'departamento',
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS street_number text,
  ADD COLUMN IF NOT EXISTS floor text,
  ADD COLUMN IF NOT EXISTS apartment_letter text,
  ADD COLUMN IF NOT EXISTS city text DEFAULT 'Mar del Plata',
  ADD COLUMN IF NOT EXISTS province text DEFAULT 'Buenos Aires',
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'Argentina',
  ADD COLUMN IF NOT EXISTS latitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS longitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS price_currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS expenses_ars numeric,
  ADD COLUMN IF NOT EXISTS surface_total_m2 numeric,
  ADD COLUMN IF NOT EXISTS bedrooms integer,
  ADD COLUMN IF NOT EXISTS bathrooms integer,
  ADD COLUMN IF NOT EXISTS garage integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS age_years integer,
  ADD COLUMN IF NOT EXISTS orientation text,
  ADD COLUMN IF NOT EXISTS condition text DEFAULT 'usado',
  ADD COLUMN IF NOT EXISTS amenities jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_published boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS unpublished_at timestamptz,
  ADD COLUMN IF NOT EXISTS ml_item_id text,
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS floor_plan_url text;

-- 3) Reemplazar el CHECK constraint de status (ampliar valores admitidos)
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_status_check;
ALTER TABLE properties ADD CONSTRAINT properties_status_check
  CHECK (status IN ('borrador','disponible','reservada','vendida','alquilada','caida','pausada'));

-- 4) Constraints + indexes únicos
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_internal_code_key;
ALTER TABLE properties ADD CONSTRAINT properties_internal_code_key UNIQUE (internal_code);

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_slug_key;
ALTER TABLE properties ADD CONSTRAINT properties_slug_key UNIQUE (slug);

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_operation_type_check;
ALTER TABLE properties ADD CONSTRAINT properties_operation_type_check
  CHECK (operation_type IN ('venta','alquiler','temporario'));

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_property_type_check;
ALTER TABLE properties ADD CONSTRAINT properties_property_type_check
  CHECK (property_type IN ('departamento','casa','ph','local','cochera','terreno','quinta','oficina','galpon'));

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_price_currency_check;
ALTER TABLE properties ADD CONSTRAINT properties_price_currency_check
  CHECK (price_currency IN ('USD','ARS'));

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_condition_check;
ALTER TABLE properties ADD CONSTRAINT properties_condition_check
  CHECK (condition IN ('nuevo','usado','a_reciclar','reciclado','en_construccion','a_estrenar'));

CREATE INDEX IF NOT EXISTS idx_properties_is_published ON properties(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city);
CREATE INDEX IF NOT EXISTS idx_properties_property_type ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_operation_type ON properties(operation_type);

-- 5) Tabla property_photos (multi-foto + orden + portada)
CREATE TABLE IF NOT EXISTS property_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url text NOT NULL,
  storage_path text,
  order_index integer NOT NULL DEFAULT 0,
  is_cover boolean DEFAULT false,
  alt_text text,
  width integer,
  height integer,
  size_bytes bigint,
  mime text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_property_photos_property ON property_photos(property_id, order_index);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_property_photo_cover ON property_photos(property_id) WHERE is_cover = true;

-- 6) Tabla property_status_history
CREATE TABLE IF NOT EXISTS property_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES agents(id),
  changed_at timestamptz DEFAULT now(),
  reason text
);
CREATE INDEX IF NOT EXISTS idx_property_status_history ON property_status_history(property_id, changed_at);

-- 7) Tabla property_price_history (importante para ML que detecta reducciones agresivas)
CREATE TABLE IF NOT EXISTS property_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  old_price numeric,
  new_price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  changed_by uuid REFERENCES agents(id),
  changed_at timestamptz DEFAULT now(),
  reason text
);
CREATE INDEX IF NOT EXISTS idx_property_price_history ON property_price_history(property_id, changed_at);

-- 8) Trigger: auto-generar internal_code antes de INSERT
CREATE OR REPLACE FUNCTION fn_set_property_internal_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.internal_code IS NULL OR NEW.internal_code = '' THEN
    NEW.internal_code := 'TURDO-' || LPAD(nextval('property_internal_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_property_internal_code ON properties;
CREATE TRIGGER trg_set_property_internal_code
BEFORE INSERT ON properties
FOR EACH ROW EXECUTE FUNCTION fn_set_property_internal_code();

-- 9) Trigger: auto-generar slug desde address + internal_code antes de INSERT
CREATE OR REPLACE FUNCTION fn_set_property_slug()
RETURNS TRIGGER AS $$
DECLARE
  base text;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base := COALESCE(NEW.address, NEW.street, '');
    -- Normalizar: minúsculas, sacar tildes, espacios → guiones
    base := lower(translate(base,
      'áéíóúÁÉÍÓÚñÑäëïöüÄËÏÖÜ',
      'aeiouAEIOUnNaeiouAEIOU'));
    base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
    base := regexp_replace(base, '^-+|-+$', '', 'g');
    IF base = '' THEN
      base := 'propiedad';
    END IF;
    NEW.slug := substr(base, 1, 80) || '-' || lower(NEW.internal_code);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_property_slug ON properties;
CREATE TRIGGER trg_set_property_slug
BEFORE INSERT ON properties
FOR EACH ROW EXECUTE FUNCTION fn_set_property_slug();

-- 10) Trigger: log de cambios de status + manejo de published_at / unpublished_at
CREATE OR REPLACE FUNCTION fn_log_property_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO property_status_history (property_id, old_status, new_status)
    VALUES (NEW.id, NULL, NEW.status);
  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO property_status_history (property_id, old_status, new_status)
      VALUES (NEW.id, OLD.status, NEW.status);
    END IF;
    IF OLD.is_published IS DISTINCT FROM NEW.is_published THEN
      IF NEW.is_published THEN
        NEW.published_at := now();
      ELSE
        NEW.unpublished_at := now();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_property_status_change ON properties;
CREATE TRIGGER trg_log_property_status_change
BEFORE INSERT OR UPDATE ON properties
FOR EACH ROW EXECUTE FUNCTION fn_log_property_status_change();

-- 11) Trigger: log de cambios de precio
CREATE OR REPLACE FUNCTION fn_log_property_price_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.list_price_usd IS DISTINCT FROM NEW.list_price_usd THEN
    INSERT INTO property_price_history (property_id, old_price, new_price, currency)
    VALUES (NEW.id, OLD.list_price_usd, NEW.list_price_usd, COALESCE(NEW.price_currency, 'USD'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_property_price_change ON properties;
CREATE TRIGGER trg_log_property_price_change
AFTER UPDATE ON properties
FOR EACH ROW EXECUTE FUNCTION fn_log_property_price_change();

-- 12) Trigger updated_at
CREATE OR REPLACE FUNCTION fn_properties_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_properties_updated_at ON properties;
CREATE TRIGGER trg_properties_updated_at
BEFORE UPDATE ON properties
FOR EACH ROW EXECUTE FUNCTION fn_properties_set_updated_at();

-- 13) Backfill: las propiedades existentes que no tienen internal_code/slug
UPDATE properties
SET internal_code = 'TURDO-' || LPAD(nextval('property_internal_seq')::text, 4, '0')
WHERE internal_code IS NULL;

UPDATE properties
SET slug = lower(
  regexp_replace(
    regexp_replace(
      translate(COALESCE(address, 'propiedad'),
        'áéíóúÁÉÍÓÚñÑäëïöüÄËÏÖÜ',
        'aeiouAEIOUnNaeiouAEIOU'),
      '[^a-zA-Z0-9]+', '-', 'g'),
    '^-+|-+$', '', 'g')
) || '-' || lower(internal_code)
WHERE slug IS NULL;

-- 14) Vista pública para web/ML (solo propiedades publicadas, con foto de portada)
CREATE OR REPLACE VIEW v_published_properties AS
SELECT
  p.id,
  p.internal_code,
  p.slug,
  p.operation_type,
  p.property_type,
  p.address,
  p.street,
  p.street_number,
  p.floor,
  p.apartment_letter,
  p.barrio,
  p.city,
  p.province,
  p.country,
  p.latitude,
  p.longitude,
  p.list_price_usd,
  p.price_currency,
  p.expenses_ars,
  p.rooms,
  p.bedrooms,
  p.bathrooms,
  p.garage,
  p.surface_m2,
  p.surface_total_m2,
  p.age_years,
  p.orientation,
  p.condition,
  p.amenities,
  p.description,
  p.video_url,
  p.floor_plan_url,
  p.cover_photo_url,
  p.ml_item_id,
  p.published_at,
  p.updated_at,
  (SELECT json_agg(json_build_object('url', ph.url, 'order', ph.order_index, 'is_cover', ph.is_cover) ORDER BY ph.order_index)
   FROM property_photos ph WHERE ph.property_id = p.id) as photos
FROM properties p
WHERE p.is_published = true AND p.status IN ('disponible','reservada');
