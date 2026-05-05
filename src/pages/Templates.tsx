import { useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { templatesApi, type MessageTemplate } from '../services/templates';

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
      setTemplates(await templatesApi.listForAgent(currentUser.id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [currentUser.id]);

  const handleSave = async (draft: MessageTemplate) => {
    if (creating) {
      await templatesApi.create({
        name: draft.name, body: draft.body, category: draft.category,
        shortcut: draft.shortcut, agent_id: draft.agent_id,
        created_by: currentUser.id,
      });
    } else {
      await templatesApi.update(draft.id, {
        name: draft.name, body: draft.body, category: draft.category,
        shortcut: draft.shortcut, agent_id: draft.agent_id,
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
      agent_id: currentUser.role === 'admin' ? null : currentUser.id,
      shortcut: null,
      use_count: 0,
      created_by: currentUser.id,
      created_at: '',
      updated_at: '',
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Plantillas de mensajes</h1>
          <p className="text-muted text-sm mt-0.5">
            Respuestas rápidas con variables: <code className="bg-bg-soft px-1 rounded text-[10px]">{'{nombre}'}</code>{' '}
            <code className="bg-bg-soft px-1 rounded text-[10px]">{'{propiedad}'}</code>{' '}
            <code className="bg-bg-soft px-1 rounded text-[10px]">{'{agente}'}</code>{' '}
            <code className="bg-bg-soft px-1 rounded text-[10px]">{'{telefono}'}</code>{' '}
            <code className="bg-bg-soft px-1 rounded text-[10px]">{'{email}'}</code>{' '}
            <code className="bg-bg-soft px-1 rounded text-[10px]">{'{sucursal}'}</code>
          </p>
        </div>
        <button onClick={startCreate} className="bg-crimson hover:bg-crimson-light text-white px-4 py-2 rounded-xl text-sm font-medium">
          + Nueva plantilla
        </button>
      </div>

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
                  <button onClick={() => { setEditing(t); setCreating(false); }} className="text-xs text-crimson hover:underline">Editar</button>
                  <button onClick={() => handleDelete(t.id)} className="text-xs text-muted hover:text-red-600">Eliminar</button>
                </div>
              </div>
            </div>
          ))}
          {templates.length === 0 && (
            <div className="text-center py-12 text-muted text-sm">
              No hay plantillas todavía. Tocá "+ Nueva" para crear la primera.
            </div>
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
