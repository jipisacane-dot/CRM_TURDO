-- Tasaciones de propiedades con IA + comparables Tokko.

CREATE TABLE IF NOT EXISTS public.appraisals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  agent_id text NOT NULL,

  -- Datos de la propiedad a tasar
  property_address text NOT NULL,
  barrio text,
  rooms integer,
  bedrooms integer,
  surface_m2 numeric,
  surface_total_m2 numeric,
  age_years integer,
  property_state text,            -- a_estrenar | reciclado | usado_buen_estado | usado_regular
  has_view boolean DEFAULT false,
  view_type text,                 -- al_mar | lateral_mar | a_la_calle | interno | otro
  amenities text[] DEFAULT '{}',  -- ['balcon', 'ascensor', 'cochera', 'amenities', 'parrilla', 'piscina', 'sum']
  expenses_ars integer,
  floor_number integer,
  exposure text,                  -- frente | contrafrente | lateral
  notes text,

  -- Datos del propietario / cliente
  client_name text,
  client_email text,
  client_phone text,

  -- Resultado de la tasación (IA + Tokko)
  suggested_price_low_usd integer,
  suggested_price_high_usd integer,
  comparables jsonb DEFAULT '[]'::jsonb,
  ai_reasoning text,
  market_summary text,
  recommendations text[] DEFAULT '{}',
  estimated_sale_days integer,

  -- Meta
  pdf_url text,
  status text NOT NULL DEFAULT 'draft', -- draft | sent | won | lost
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appraisals_contact_idx ON public.appraisals(contact_id);
CREATE INDEX IF NOT EXISTS appraisals_agent_idx ON public.appraisals(agent_id);
CREATE INDEX IF NOT EXISTS appraisals_created_idx ON public.appraisals(created_at DESC);

CREATE OR REPLACE FUNCTION fn_appraisals_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appraisals_touch ON public.appraisals;
CREATE TRIGGER trg_appraisals_touch
BEFORE UPDATE ON public.appraisals
FOR EACH ROW EXECUTE FUNCTION fn_appraisals_touch();

COMMENT ON COLUMN public.appraisals.suggested_price_low_usd IS 'Rango bajo del precio sugerido (USD)';
COMMENT ON COLUMN public.appraisals.suggested_price_high_usd IS 'Rango alto del precio sugerido (USD)';
COMMENT ON COLUMN public.appraisals.comparables IS 'Array de {address, barrio, price, m2, rooms, state, link, source} de propiedades similares';
COMMENT ON COLUMN public.appraisals.ai_reasoning IS 'Razonamiento de la IA explicando el precio sugerido';
COMMENT ON COLUMN public.appraisals.recommendations IS 'Sugerencias accionables (mejoras, fotos, timing)';
