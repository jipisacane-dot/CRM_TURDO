-- Mini-portal del cliente: link único que el vendedor genera y le manda al lead.
-- Cada portal trackea views, fotos abiertas, plano descargado, visita pedida, etc.

CREATE TABLE IF NOT EXISTS public.client_portals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  property_ids uuid[] NOT NULL DEFAULT '{}',
  client_greeting text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 days'),
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  is_active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS client_portals_contact_idx ON public.client_portals(contact_id);
CREATE INDEX IF NOT EXISTS client_portals_token_idx ON public.client_portals(token);

CREATE TABLE IF NOT EXISTS public.portal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id uuid NOT NULL REFERENCES public.client_portals(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_events_portal_idx ON public.portal_events(portal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_events_type_idx ON public.portal_events(event_type);

-- Vista resumen por portal: cuántas veces se vio, cuándo, qué eventos hubo
CREATE OR REPLACE VIEW public.v_portal_summary AS
SELECT
  cp.id              AS portal_id,
  cp.token,
  cp.contact_id,
  cp.agent_id,
  cp.created_at,
  cp.expires_at,
  cp.is_active,
  cp.view_count,
  cp.last_viewed_at,
  cp.property_ids,
  c.name             AS contact_name,
  c.channel          AS contact_channel,
  COALESCE(ev_stats.total_events, 0)         AS total_events,
  ev_stats.first_view_at,
  ev_stats.unique_views
FROM public.client_portals cp
LEFT JOIN public.contacts c ON c.id = cp.contact_id
LEFT JOIN LATERAL (
  SELECT
    count(*)                                                 AS total_events,
    min(created_at) FILTER (WHERE event_type = 'view')       AS first_view_at,
    count(DISTINCT date_trunc('hour', created_at)) FILTER (WHERE event_type = 'view') AS unique_views
  FROM public.portal_events
  WHERE portal_id = cp.id
) ev_stats ON true
ORDER BY cp.created_at DESC;
