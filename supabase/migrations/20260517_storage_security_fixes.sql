-- ============================================================
-- Storage security hardening — 2026-05-17
-- ============================================================
-- Fix 1: operation-docs (DNIs, escrituras, contratos) — bloquear anon
-- Fix 2: chat-media — quitar lectura pública directa (solo signed URLs)
-- Fix 3: property-photos — bloquear escritura anon, mantener lectura pública
-- Bonus: agent-avatars — endurecer write/delete
-- ============================================================

-- ──────────────────────────────────────────────────────
-- FIX 1: operation-docs
-- Antes: anon podía leer/escribir/borrar/modificar TODO (DNIs, escrituras).
-- Ahora: solo authenticated.
-- ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS operation_docs_anon_all ON storage.objects;
DROP POLICY IF EXISTS operation_docs_read ON storage.objects;
DROP POLICY IF EXISTS operation_docs_insert ON storage.objects;
DROP POLICY IF EXISTS operation_docs_update ON storage.objects;
DROP POLICY IF EXISTS operation_docs_delete ON storage.objects;

CREATE POLICY operation_docs_authenticated_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'operation-docs');
CREATE POLICY operation_docs_authenticated_write ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'operation-docs');
CREATE POLICY operation_docs_authenticated_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'operation-docs');
CREATE POLICY operation_docs_authenticated_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'operation-docs');

-- ──────────────────────────────────────────────────────
-- FIX 2: chat-media
-- Antes: cualquiera con el path podía leer fotos/audios/docs privados.
-- Ahora: solo authenticated (vendedores logueados) lee. Acceso público
-- vía signed URLs (que usan service_role y bypasan RLS).
-- ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS chat_media_public_read ON storage.objects;
DROP POLICY IF EXISTS chat_media_read ON storage.objects;
DROP POLICY IF EXISTS chat_media_insert ON storage.objects;

CREATE POLICY chat_media_authenticated_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'chat-media');

-- ──────────────────────────────────────────────────────
-- FIX 3: property-photos
-- Antes: anon podía borrar, subir y modificar fotos de propiedades.
-- Ahora: lectura pública (sitio web visible), pero escritura solo authenticated.
-- ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "property-photos anon upload" ON storage.objects;
DROP POLICY IF EXISTS "property-photos anon update" ON storage.objects;
DROP POLICY IF EXISTS "property-photos anon delete" ON storage.objects;
DROP POLICY IF EXISTS "property-photos public read" ON storage.objects;

CREATE POLICY property_photos_public_read ON storage.objects FOR SELECT TO public USING (bucket_id = 'property-photos');
CREATE POLICY property_photos_authenticated_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'property-photos');
CREATE POLICY property_photos_authenticated_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'property-photos');
CREATE POLICY property_photos_authenticated_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'property-photos');

-- ──────────────────────────────────────────────────────
-- BONUS: agent-avatars
-- Antes: cualquier rol podía hacer todo.
-- Ahora: read público (visible en perfiles publicados), write/delete solo authenticated.
-- ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS avatars_read ON storage.objects;
DROP POLICY IF EXISTS avatars_insert ON storage.objects;
DROP POLICY IF EXISTS avatars_update ON storage.objects;
DROP POLICY IF EXISTS avatars_delete ON storage.objects;

CREATE POLICY agent_avatars_public_read ON storage.objects FOR SELECT TO public USING (bucket_id = 'agent-avatars');
CREATE POLICY agent_avatars_authenticated_write ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'agent-avatars');
CREATE POLICY agent_avatars_authenticated_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'agent-avatars');
CREATE POLICY agent_avatars_authenticated_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'agent-avatars');
