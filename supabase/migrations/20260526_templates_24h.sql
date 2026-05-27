-- Agrega soporte para templates pre-aprobados por Meta WhatsApp Business
-- (los unicos que se pueden enviar fuera de la ventana de 24hs).
--
-- Workflow:
--   1. Vendor crea template en el CRM con is_24h_template=true y
--      meta_template_name (nombre exacto registrado en Meta Business).
--   2. Leti registra el template en Meta Business -> WhatsApp -> Templates.
--      Meta revisa en 24-48h y lo marca como APPROVED.
--   3. Cuando meta_template_status='APPROVED', el CRM puede usarlo para
--      reactivar contactos fuera de la ventana 24h (via WSP Cloud API
--      directo, con messaging_product=whatsapp + type=template).
--
-- meta_template_language: por defecto es_AR (espanol Argentina), Meta acepta
-- varios codigos pero ese es el matching mas comun para Turdo.

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS is_24h_template BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS meta_template_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_template_language TEXT DEFAULT 'es_AR',
  ADD COLUMN IF NOT EXISTS meta_template_status TEXT;

-- Index para query rapida de templates 24h aprobados en el TemplatePicker
CREATE INDEX IF NOT EXISTS idx_message_templates_24h_approved
  ON message_templates (is_24h_template, meta_template_status)
  WHERE is_24h_template = true;

COMMENT ON COLUMN message_templates.is_24h_template IS
  'TRUE = es un template registrado en Meta Business para enviar fuera de la ventana de 24hs. Requiere meta_template_name + aprobacion de Meta.';
COMMENT ON COLUMN message_templates.meta_template_name IS
  'Nombre exacto del template en Meta Business (case sensitive). Ej: "saludo_reactivacion_v1"';
COMMENT ON COLUMN message_templates.meta_template_status IS
  'Estado segun Meta: NULL/PENDING/APPROVED/REJECTED. Solo APPROVED se puede usar.';
