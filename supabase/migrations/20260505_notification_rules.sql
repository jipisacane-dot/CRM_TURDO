-- Fase 3 — Reglas de notificaciones configurables
-- Tabla single-row-per-rule con cadencia ajustable. Una edge function notification-engine
-- corre cada 15 min, lee las reglas con enabled=true y dispara los pushes correspondientes.
-- El cooldown se trackea en la tabla `escalations` ya existente (contact_id + type + created_at).

CREATE TABLE IF NOT EXISTS public.notification_rules (
  rule_key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  threshold_minutes integer,
  cooldown_hours integer NOT NULL DEFAULT 12,
  notify_assigned_agent boolean NOT NULL DEFAULT true,
  notify_admin boolean NOT NULL DEFAULT false,
  push_title text NOT NULL,
  push_body text NOT NULL,
  applies_to_stages text[] NOT NULL DEFAULT '{}',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.notification_rules.threshold_minutes IS 'Minutos desde el evento referencia para disparar';
COMMENT ON COLUMN public.notification_rules.applies_to_stages IS 'Etapas del pipeline donde aplica. Vacío = todas';
COMMENT ON COLUMN public.notification_rules.config IS 'Params extra. Ej: paused_followup_days = 7';
COMMENT ON COLUMN public.notification_rules.push_body IS 'Soporta tokens: {contact_name}, {hours}, {minutes}, {days}, {stage}';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION fn_notification_rules_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_rules_touch ON public.notification_rules;
CREATE TRIGGER trg_notification_rules_touch
BEFORE UPDATE ON public.notification_rules
FOR EACH ROW EXECUTE FUNCTION fn_notification_rules_touch();

-- Seed de reglas iniciales
INSERT INTO public.notification_rules (rule_key, name, description, enabled, threshold_minutes, cooldown_hours, notify_assigned_agent, notify_admin, push_title, push_body, applies_to_stages, config) VALUES
(
  'agent_no_reply_15min',
  'Recordatorio al vendedor (15 min)',
  'Si el vendedor asignado no respondió un mensaje del cliente en 15 minutos, se le manda un recordatorio',
  true, 15, 1, true, false,
  '⏰ Tenés un mensaje sin responder',
  '{contact_name} esperando hace {minutes} min',
  ARRAY['nuevo','en_conversacion','visita_programada','propuesta_enviada','en_negociacion'],
  '{}'::jsonb
),
(
  'agent_no_reply_4h',
  'Escalado a Leti (4hs)',
  'Si el vendedor no respondió en 4hs, se le notifica también a la admin (Leti)',
  true, 240, 12, true, true,
  '🚨 Lead sin respuesta hace 4hs',
  '{contact_name} ({stage}) — el vendedor no respondió hace {hours} hs',
  ARRAY['nuevo','en_conversacion','visita_programada','propuesta_enviada','en_negociacion'],
  '{}'::jsonb
),
(
  'cold_24h',
  'Lead frío (24hs sin actividad)',
  'Sin actividad en 24hs → push al vendedor y a la admin marcando como frío',
  true, 1440, 24, true, true,
  '❄️ Lead frío — sin actividad 24hs',
  '{contact_name} ({stage}) — última actividad hace {hours} hs',
  ARRAY['nuevo','en_conversacion','visita_programada','propuesta_enviada','en_negociacion'],
  '{"max_age_days": 14}'::jsonb
),
(
  'paused_followup',
  'Seguimiento de leads en pausa',
  'Leads en etapa "en_pausa" cumple N días → recordatorio al vendedor para reactivar',
  true, NULL, 48, true, false,
  '🔁 Tiempo de seguimiento',
  '{contact_name} está en pausa hace {days} días — momento de reactivar',
  ARRAY['en_pausa'],
  '{"followup_days": 7}'::jsonb
),
(
  'visit_reminder_1h',
  'Recordatorio visita 1hs antes',
  'Para reminders con due_at en la próxima hora, push al vendedor con la visita',
  true, 60, 2, true, false,
  '📅 Visita en 1 hora',
  '{contact_name} — recordatorio de visita',
  ARRAY['visita_programada','propuesta_enviada','en_negociacion'],
  '{}'::jsonb
)
ON CONFLICT (rule_key) DO NOTHING;

-- Index para queries de cooldown
CREATE INDEX IF NOT EXISTS escalations_contact_type_created_idx
  ON public.escalations(contact_id, type, created_at DESC);
