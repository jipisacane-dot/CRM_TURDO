import { useEffect, useMemo, useState } from 'react';
import { templatesApi, renderTemplate, type MessageTemplate } from '../services/templates';
import type { Lead, Agent } from '../types';

interface Props {
  lead: Lead;
  agent: Agent;
  onPick: (rendered: string, template: MessageTemplate) => void;
}

export default function TemplatePicker({ lead, agent, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    templatesApi.listForAgent(agent.id)
      .then(setTemplates)
      .finally(() => setLoading(false));
  }, [open, agent.id]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q) ||
      (t.shortcut?.toLowerCase().includes(q) ?? false) ||
      t.category.toLowerCase().includes(q)
    );
  }, [templates, filter]);

  const handlePick = (t: MessageTemplate) => {
    const rendered = renderTemplate(t.body, { lead, agent });
    onPick(rendered, t);
    void templatesApi.incrementUse(t.id).catch(() => {});
    setOpen(false);
    setFilter('');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Plantillas (Ctrl+/)"
        className="bg-bg-input border border-border hover:border-crimson text-muted hover:text-white px-3 py-3 rounded-xl text-sm transition-colors flex-shrink-0"
      >
        📋
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-3 border-b border-border flex items-center gap-2">
              <span className="text-base">📋</span>
              <input
                autoFocus
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Buscar plantilla por nombre, atajo o contenido…"
                className="flex-1 outline-none text-sm text-[#0F172A] placeholder:text-muted"
              />
              <button onClick={() => setOpen(false)} className="text-muted hover:text-[#0F172A] text-sm px-2">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="text-center py-8 text-muted text-sm">Cargando plantillas…</div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 text-muted text-sm">
                  Sin plantillas. <a href="/templates" className="text-crimson hover:underline">Crear una</a>
                </div>
              ) : (
                filtered.map(t => {
                  const preview = renderTemplate(t.body, { lead, agent });
                  return (
                    <button
                      key={t.id}
                      onClick={() => handlePick(t)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-bg-soft border border-transparent hover:border-border transition-colors mb-1"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-[#0F172A]">{t.name}</span>
                        {t.shortcut && <code className="text-[10px] bg-bg-soft px-1.5 py-0.5 rounded text-muted">/{t.shortcut}</code>}
                        <span className="text-[10px] text-muted ml-auto">{t.category}</span>
                      </div>
                      <div className="text-xs text-muted line-clamp-2">{preview}</div>
                    </button>
                  );
                })
              )}
            </div>
            <div className="p-2 border-t border-border bg-bg-soft text-xs text-muted text-center">
              <a href="/templates" className="hover:text-crimson hover:underline">Gestionar plantillas →</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
