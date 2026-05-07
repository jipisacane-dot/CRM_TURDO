-- Permitir upload anon SOLO a appraisals/* dentro del bucket chat-media.
-- Razón: el CRM usa session mock en localStorage (no Supabase Auth), así que
-- los uploads desde el form de tasación van como rol `anon`. Restringimos al
-- subpath para que no se pueda escribir en otras carpetas (chat, etc.).

DO $$ BEGIN
  CREATE POLICY "chat_media_anon_write_appraisals" ON storage.objects
    FOR INSERT TO public
    WITH CHECK (bucket_id = 'chat-media' AND name LIKE 'appraisals/%');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
