-- Plantillas de mensajes con variables reemplazables.
-- Globales (agent_id NULL) o privadas por vendedor (agent_id = id del agente).
-- Variables soportadas en body: {nombre}, {telefono}, {email}, {propiedad}, {agente}, {sucursal}.

CREATE TABLE IF NOT EXISTS public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  body text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  agent_id text,
  shortcut text,
  use_count integer NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_templates_agent_idx ON public.message_templates(agent_id);
CREATE INDEX IF NOT EXISTS message_templates_category_idx ON public.message_templates(category);

CREATE OR REPLACE FUNCTION fn_message_templates_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_templates_touch ON public.message_templates;
CREATE TRIGGER trg_message_templates_touch
BEFORE UPDATE ON public.message_templates
FOR EACH ROW EXECUTE FUNCTION fn_message_templates_touch();

-- Plantillas seed (globales para todo el equipo)
INSERT INTO public.message_templates (name, body, category, shortcut, created_by) VALUES
('Saludo inicial', 'Hola {nombre}! Soy {agente} de Turdo Inmobiliaria. Recibí tu consulta sobre {propiedad}. ¿Cuándo te queda cómodo que te llame para contarte los detalles?', 'apertura', 'hola', 'system'),
('Coordinar visita', '{nombre}, te paso opciones de horario para ver el departamento esta semana: jueves 11hs, viernes 16hs o sábado 10hs. ¿Cuál te queda mejor?', 'visita', 'visita', 'system'),
('Pedir datos al lead', '{nombre} para armarte una propuesta a medida necesito 3 datos: 1) presupuesto en USD, 2) si es para vivir o invertir, 3) cuándo querés mudarte. ¿Me los pasás?', 'calificacion', 'datos', 'system'),
('Sin disponibilidad ahora', 'Hola {nombre}, gracias por tu mensaje. Esa propiedad ya está en negociación pero tengo otras 3 opciones similares en {sucursal}. ¿Querés que te las pase?', 'objeciones', 'reservada', 'system'),
('Recordatorio post visita', '{nombre} te paso el resumen de la visita y el plano del depto. ¿Tenés alguna duda o querés avanzar con la reserva?', 'seguimiento', 'postvisita', 'system'),
('Cierre / boleto', 'Excelente {nombre}, paso a redactar el boleto. Necesito copia DNI de ambas partes y comprobante de origen de fondos. ¿Te queda bien firmar el martes en nuestras oficinas de {sucursal}?', 'cierre', 'boleto', 'system'),
('Tasación gratis', 'Hola {nombre}, sin compromiso te tasamos tu departamento con datos reales de los últimos 90 días en tu zona. ¿Cuándo paso a verlo?', 'captacion', 'tasacion', 'system'),
('Reactivar lead frío', 'Hola {nombre}, ¿seguís en la búsqueda? Esta semana entraron 3 propiedades nuevas que podrían interesarte. Te paso fotos y precios?', 'seguimiento', 'reactivar', 'system')
ON CONFLICT DO NOTHING;
