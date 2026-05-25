-- Track delivery status de mensajes salientes.
-- Causa: cuando send-message falla (ej: contacto no vinculado a ManyChat),
-- el mensaje queda guardado en DB pero nunca llegó al cliente. Sin esta
-- columna no había forma de distinguir "enviado pero falló" vs "enviado OK".

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'sent'
    CHECK (delivery_status IN ('sent','failed','pending')),
  ADD COLUMN IF NOT EXISTS delivery_error text;

-- Index para queries de fallidos (panel admin de errores futuros)
CREATE INDEX IF NOT EXISTS idx_messages_failed
  ON messages(created_at DESC)
  WHERE delivery_status = 'failed';
