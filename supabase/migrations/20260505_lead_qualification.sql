-- Calificación automática de leads con IA: hot / warm / cold + score 0-100.
-- Se calcula via edge function `qualify-lead` cuando hay 3+ mensajes IN o el lead pasa de "nuevo" a otra etapa.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS quality_label text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS quality_score integer;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS quality_reason text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS qualified_at timestamptz;

CREATE INDEX IF NOT EXISTS contacts_quality_label_idx ON public.contacts(quality_label) WHERE quality_label IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_quality_score_idx ON public.contacts(quality_score DESC) WHERE quality_score IS NOT NULL;

COMMENT ON COLUMN public.contacts.quality_label IS 'hot | warm | cold — calificación generada por IA según contenido de la conversación';
COMMENT ON COLUMN public.contacts.quality_score IS '0-100, donde 100 = lead hot con presupuesto + intent + timing claros';
COMMENT ON COLUMN public.contacts.quality_reason IS 'Razón corta en español que explica el scoring';
