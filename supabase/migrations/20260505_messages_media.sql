-- Multimedia en mensajes: fotos, videos, audios, documentos.
-- Almacenamiento en bucket `chat-media` de Supabase Storage.

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_type text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_caption text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_size_bytes integer;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_mime text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_filename text;

COMMENT ON COLUMN public.messages.media_type IS 'image | video | audio | document | sticker';
COMMENT ON COLUMN public.messages.media_url IS 'URL pública del archivo en bucket chat-media (o cualquier CDN)';
COMMENT ON COLUMN public.messages.media_caption IS 'Caption opcional que acompaña al archivo';

CREATE INDEX IF NOT EXISTS messages_media_type_idx ON public.messages(media_type) WHERE media_type IS NOT NULL;

-- Bucket para multimedia del chat (público para lectura, escritura via service role)
-- Idempotente: si ya existe, no hace nada.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  true,
  52428800, -- 50 MB
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp','image/heic',
    'video/mp4','video/quicktime','video/webm','video/3gpp',
    'audio/mpeg','audio/ogg','audio/aac','audio/mp4','audio/webm',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies: lectura pública (necesario para que <img> y <video> renderícen sin auth)
-- y escritura solo via authenticated o service role.
DO $$ BEGIN
  CREATE POLICY "chat_media_public_read" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'chat-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chat_media_authenticated_write" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'chat-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
