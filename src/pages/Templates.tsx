import { useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { templatesApi, type MessageTemplate } from '../services/templates';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';

const CATEGORIES = ['apertura', 'visita', 'calificacion', 'objeciones', 'seguimiento', 'cierre', 'captacion', 'general'];

export default function Templates() {
  const { currentUser } = useApp();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setTemplates(await templatesApi.listForAgent(currentUser.dbId ?? ''));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [currentUser.dbId]);

  const handleSave = async (draft: MessageTemplate) => {
    if (creating) {
      await templatesApi.create({
        name: draft.name, body: draft.body, category: draft.category,
        shortcut: draft.shortcut, agent_id: draft.agent_id,
        is_24h_template: draft.is_24h_template,
        meta_template_name: draft.meta_template_name,
        meta_template_language: draft.meta_template_language,
        meta_template_status: draft.meta_template_status,
        created_by: currentUser.dbId ?? '',
      });
    } else {
      await templatesApi.update(draft.id, {
        name: draft.name, body: draft.body, category: draft.category,
        shortcut: draft.shortcut, agent_id: draft.agent_id,
        is_24h_template: draft.is_24h_template,
        meta_template_name: draft.meta_template_name,
        meta_template_language: draft.meta_template_language,
        meta_template_status: draft.meta_template_status,
      });
    }
    setEditing(null);
    setCreating(false);
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta plantilla? Esta acción no se puede deshacer.')) return;
    await templatesApi.remove(id);
    await load();
  };

  const startCreate = () => {
    setCreating(true);
    setEditing({
      id: '',
      name: '',
      body: '',
      category: 'general',
      agent_id: currentUser.role === 'admin' ? null : (currentUser.dbId ?? null),
      shortcut: null,
      use_count: 0,
      created_by: currentUser.dbId ?? null,
      created_at: '',
      updated_at: '',
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-4">
      <PageHeader
        title="Plantillas de mensajes"
        subtitle="Respuestas rápidas con variables. Usá {nombre}, {propiedad}, {agente}, {sucursal}, {telefono}, {email} dentro del texto y se reemplazan automáticamente."
        actions={
          <button onClick={startCreate} className="bg-crimson hover:bg-crimson-light text-white px-4 py-2 rounded-xl text-sm font-medium">
            + Nueva plantilla
          </button>
        }
      />

      {loading ? (
        <div className="text-muted text-sm">Cargando…</div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="bg-white border border-border rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-semibold text-[#0F172A]">{t.name}</span>
                    {t.shortcut && <code className="text-[10px] bg-bg-soft px-1.5 py-0.5 rounded text-muted">/{t.shortcut}</code>}
                    <span className="text-[10px] text-muted bg-bg-soft px-2 py-0.5 rounded-full">{t.category}</span>
                    {t.agent_id ? (
                      <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">privada</span>
                    ) : (
                      <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">global</span>
                    )}
                    <span className="text-[10px] text-muted">· usada {t.use_count}×</span>
                  </div>
                  <div className="text-sm text-[#0F172A] mt-2 whitespace-pre-wrap">{t.body}</div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {/* Solo el creador o admin pueden editar/borrar. Templates globales
                      creadas por admin: solo admin las modifica. */}
                  {(currentUser.role === 'admin' || t.created_by === currentUser.dbId) ? (
                    <>
                      <button onClick={() => { setEditing(t); setCreating(false); }} className="text-xs text-crimson hover:underline">Editar</button>
                      <button onClick={() => handleDelete(t.id)} className="text-xs text-muted hover:text-red-600">Eliminar</button>
                    </>
                  ) : (
                    <span className="text-xs text-muted italic" title="Solo el creador o un admin pueden modificar esta plantilla">solo lectura</span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {templates.length === 0 && (
            <EmptyState
              icon="📋"
              title="No hay plantillas todavía"
              description="Las plantillas son respuestas rápidas que el equipo puede insertar con un click en cualquier chat."
              action={
                <button onClick={startCreate} className="bg-crimson text-white px-4 py-2 rounded-xl text-sm font-medium">
                  + Crear la primera
                </button>
              }
            />
          )}
        </div>
      )}

      {editing && (
        <EditModal
          draft={editing}
          isCreating={creating}
          isAdmin={currentUser.role === 'admin'}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

const EditModal = ({ draft, isCreating, isAdmin, onSave, onCancel }: {
  draft: MessageTemplate;
  isCreating: boolean;
  isAdmin: boolean;
  onSave: (t: MessageTemplate) => Promise<void>;
  onCancel: () => void;
}) => {
  const [t, setT] = useState(draft);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!t.name.trim() || !t.body.trim()) return;
    setSaving(true);
    try {
      await onSave(t);
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-[#0F172A]">{isCreating ? 'Nueva plantilla' : 'Editar plantilla'}</h2>

        <label className="block">
          <span className="text-xs text-muted">Nombre</span>
          <input value={t.name} onChange={e => setT({ ...t, name: e.target.value })}
            className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm text-[#0F172A]" />
        </label>

        <label className="block">
          <span className="text-xs text-muted">Atajo (opcional, para escribir /atajo en el chat)</span>
          <input value={t.shortcut ?? ''} onChange={e => setT({ ...t, shortcut: e.target.value || null })}
            placeholder="ej: hola, visita"
            className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm text-[#0F172A]" />
        </label>

        <label className="block">
          <span className="text-xs text-muted">Categoría</span>
          <select value={t.category} onChange={e => setT({ ...t, category: e.target.value })}
            className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm text-[#0F172A]">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-muted">Mensaje (variables: {'{nombre}'} {'{propiedad}'} {'{agente}'} {'{sucursal}'} {'{telefono}'} {'{email}'})</span>
          <textarea value={t.body} onChange={e => setT({ ...t, body: e.target.value })}
            rows={6}
            className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm text-[#0F172A] resize-y" />
        </label>

        {isAdmin && (
          <label className="block">
            <span className="text-xs text-muted">Visibilidad</span>
            <select
              value={t.agent_id ?? ''}
              onChange={e => setT({ ...t, agent_id: e.target.value || null })}
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm text-[#0F172A]"
            >
              <option value="">Global (toda la compañía)</option>
              <option value={t.agent_id ?? ''} disabled hidden></option>
            </select>
          </label>
        )}

        {/* Template 24h+: para reactivar contactos fuera de la ventana de 24hs.
            Solo funciona cuando el template está registrado y APROBADO por Meta
            en Business Manager → WhatsApp → Templates. */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={t.is_24h_template ?? false}
              onChange={e => setT({ ...t, is_24h_template: e.target.checked })}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-800">
                Es plantilla para reactivar fuera de las 24hs
              </div>
              <div className="text-[11px] text-amber-700 mt-0.5">
                Solo se puede usar cuando Meta la aprueba en Business → WhatsApp → Templates.
              </div>
            </div>
          </label>
          {t.is_24h_template && (
            <>
              <label className="block">
                <span className="text-[11px] text-amber-800">Nombre del template en Meta (case-sensitive)</span>
                <input
                  value={t.meta_template_name ?? ''}
                  onChange={e => setT({ ...t, meta_template_name: e.target.value || null })}
                  placeholder="ej: saludo_reactivacion_v1"
                  className="w-full mt-1 px-3 py-2 border border-amber-300 rounded-lg text-sm font-mono text-[#0F172A]"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-amber-800">Idioma</span>
                <select
                  value={t.meta_template_language ?? 'es_AR'}
                  onChange={e => setT({ ...t, meta_template_language: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border border-amber-300 rounded-lg text-sm text-[#0F172A]"
                >
                  <option value="es_AR">Español (Argentina)</option>
                  <option value="es">Español genérico</option>
                  <option value="es_MX">Español (México)</option>
                  <option value="en">English</option>
                </select>
              </label>
              {isAdmin && (
                <label className="block">
                  <span className="text-[11px] text-amber-800">Estado en Meta</span>
                  <select
                    value={t.meta_template_status ?? ''}
                    onChange={e => setT({ ...t, meta_template_status: (e.target.value || null) as 'PENDING' | 'APPROVED' | 'REJECTED' | null })}
                    className="w-full mt-1 px-3 py-2 border border-amber-300 rounded-lg text-sm text-[#0F172A]"
                  >
                    <option value="">— sin registrar todavía —</option>
                    <option value="PENDING">PENDING (esperando review de Meta)</option>
                    <option value="APPROVED">APPROVED (listo para usar)</option>
                    <option value="REJECTED">REJECTED</option>
                  </select>
                </label>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm bg-white border border-border rounded-lg">Cancelar</button>
          <button onClick={submit} disabled={saving || !t.name.trim() || !t.body.trim()}
            className="px-4 py-2 text-sm bg-crimson text-white rounded-lg disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
};
