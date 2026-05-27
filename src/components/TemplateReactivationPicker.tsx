// Picker de plantillas para reactivar contactos fuera de la ventana de 24h
// (WSP only). Se muestra en lugar del input cuando outsideWindow=true o
// cuando el contacto es nuevo y nunca escribió.
//
// Solo lista templates con:
//   - is_24h_template = true
//   - meta_template_status = 'APPROVED'

import { useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { templatesApi, type MessageTemplate, renderTemplate } from '../services/templates';
import type { Lead, Agent } from '../types';

interface Props {
  lead: Lead;
  // currentUser del AppContext = Agent + { dbId }. Aceptamos ambos para flexibilidad.
  agent: Agent & { dbId?: string | null };
  onSent: () => void;
  onCancel?: () => void;
}

export default function TemplateReactivationPicker({ lead, agent, onSent, onCancel }: Props) {
  const { sendTemplate } = useApp();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    templatesApi.listForAgent(agent.dbId ?? '')
      .then(list => {
        const approved = list.filter(t =>
          t.is_24h_template === true &&
          t.meta_template_status === 'APPROVED' &&
          t.meta_template_name
        );
        setTemplates(approved);
      })
      .finally(() => setLoading(false));
  }, [open, agent.dbId]);

  const send = async (tpl: MessageTemplate) => {
    if (sending) return;
    setSending(true);
    setError(null);
    const r = await sendTemplate(lead.id, tpl.id);
    setSending(false);
    if (!r.ok) {
      setError(r.error ?? 'Error desconocido');
      return;
    }
    setOpen(false);
    onSent();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-3 rounded-xl text-sm font-medium transition-colors flex-shrink-0 flex items-center gap-1.5"
        title="Reactivar contacto con plantilla aprobada por Meta (fuera de ventana 24h)"
      >
        <span>📤</span>
        <span className="hidden sm:inline">Plantilla</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !sending && setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80dvh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-[#0F172A]">Enviar plantilla de reactivación</div>
                <div className="text-xs text-muted mt-0.5">A {lead.name} · {lead.phone}</div>
              </div>
              {!sending && (
                <button onClick={() => setOpen(false)} className="text-muted hover:text-[#0F172A]">✕</button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loading ? (
                <div className="text-sm text-muted">Cargando plantillas aprobadas…</div>
              ) : templates.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
                  <strong>No hay plantillas aprobadas todavía.</strong>
                  <div className="mt-2 text-xs">
                    Para reactivar contactos fuera de la ventana de 24hs necesitás:
                  </div>
                  <ol className="mt-1 list-decimal pl-5 text-xs space-y-0.5">
                    <li>Crear la plantilla en <a href="/templates" className="underline" target="_blank">Plantillas del CRM</a> con el checkbox "Es plantilla para reactivar fuera de las 24hs" prendido.</li>
                    <li>Registrar el mismo nombre en Meta Business → WhatsApp → Templates.</li>
                    <li>Esperar 24-48h a que Meta lo apruebe.</li>
                    <li>Marcar el estado como APPROVED en el CRM.</li>
                  </ol>
                </div>
              ) : (
                templates.map(t => {
                  const preview = renderTemplate(t.body, { lead, agent });
                  return (
                    <button
                      key={t.id}
                      onClick={() => void send(t)}
                      disabled={sending}
                      className="w-full text-left p-3 border border-border rounded-xl hover:border-crimson hover:bg-crimson/5 transition-all disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-[#0F172A]">{t.name}</span>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">✓ Aprobado</span>
                        {t.shortcut && <code className="text-[10px] bg-bg-soft px-1.5 py-0.5 rounded text-muted">/{t.shortcut}</code>}
                      </div>
                      <div className="text-xs text-muted whitespace-pre-wrap">{preview}</div>
                      <div className="text-[10px] text-muted mt-1">Meta: {t.meta_template_name} · {t.meta_template_language}</div>
                    </button>
                  );
                })
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex justify-between gap-2">
              <a
                href="/templates"
                target="_blank"
                className="text-xs text-crimson hover:underline self-center"
              >
                + Crear nueva plantilla
              </a>
              {!sending && (
                <button
                  onClick={() => { setOpen(false); onCancel?.(); }}
                  className="px-3 py-2 bg-white border border-border rounded-lg text-sm"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
