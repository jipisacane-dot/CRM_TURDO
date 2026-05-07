-- Compartir tasaciones por link público + fotos del depto.

ALTER TABLE public.appraisals ADD COLUMN IF NOT EXISTS share_token text UNIQUE;
ALTER TABLE public.appraisals ADD COLUMN IF NOT EXISTS photos jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.appraisals ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.appraisals ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

CREATE INDEX IF NOT EXISTS appraisals_share_token_idx ON public.appraisals(share_token) WHERE share_token IS NOT NULL;

COMMENT ON COLUMN public.appraisals.share_token IS 'Token único para compartir tasación públicamente (URL: /t/:token)';
COMMENT ON COLUMN public.appraisals.photos IS 'Array de URLs públicas en bucket chat-media [{url, caption}]';
