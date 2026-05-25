-- ============================================================
-- Agregar manychat_subscriber_id a contacts — 2026-05-19
-- ============================================================
-- Para soportar el routing ManyChat-centric de WhatsApp:
--   - Meta → ManyChat → /manychat-webhook
--   - ManyChat crea subscribers con su propio ID interno
--   - Necesitamos almacenarlo para poder enviar via sendContent API
-- channel_id sigue siendo phone para compat con código existente.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS manychat_subscriber_id text;

CREATE INDEX IF NOT EXISTS contacts_manychat_subscriber_idx
  ON public.contacts(manychat_subscriber_id)
  WHERE manychat_subscriber_id IS NOT NULL;

COMMENT ON COLUMN public.contacts.manychat_subscriber_id IS
  'ManyChat internal subscriber ID for WhatsApp contacts. Set when message arrives via /manychat-webhook. Used by send-message to call ManyChat sendContent API.';
