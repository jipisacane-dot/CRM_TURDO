import { useEffect, useState } from 'react';
import { portalsApi, type PortalSummary, type PortalEvent } from '../services/portals';
import { supabase } from '../services/supabase';
import type { Lead, Agent } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface DBProperty {
  id: string;
  tokko_sku: string | null;
  address: string | null;
  barrio: string | null;
  list_price_usd: number | null;
  status: string | null;
}

interface Props {
  lead: Lead;
  agent: Agent;
}

const EVENT_LABEL: Record<string, { emoji: string; label: string }> = {
  view: { emoji: '👀', label: 'Abrió el portal' },
  photo_open: { emoji: '🖼️', label: 'Vio fotos en grande' },
  plan_download: { emoji: '📐', label: 'Descargó el plano' },
  ficha_download: { emoji: '📋', label: 'Descargó la ficha' },
  visit_request: { emoji: '📅', label: 'Pidió una visita' },
  question_sent: { emoji: '💬', label: 'Mandó una pregunta' },
  whatsapp_click: { emoji: '📱', label: 'Tocó WhatsApp' },
  map_click: { emoji: '📍', label: 'Abrió la ubicación' },
  scroll_bottom: { emoji: '📜', label: 'Leyó hasta el final' },
  leave: { emoji: '🚪', label: 'Cerró el portal' },
};

export default function ClientPortalButton({ lead, agent }: Props) {
  const [open, setOpen] = useState(false);
  const [portals, setPortals] = useState<PortalSummary[]>([]);
  const [events, setEvents] = useState<Record<string, PortalEvent[]>>({});
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [allProperties, setAllProperties] = useState<DBProperty[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [pickedProps, setPickedProps] = useState<Set<string>>(new Set());
  const [greeting, setGreeting] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const ps = await portalsApi.listForContact(lead.id);
      setPortals(ps);
      const evs: Record<string, PortalEvent[]> = {};
      await Promise.all(ps.map(async p => {
        evs[p.portal_id] = await portalsApi.listEvents(p.portal_id, 20);
      }));
      setEvents(evs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadAll();
    // Cargar lista de propiedades disponibles para el selector
    void supabase.from('properties')
      .select('id, tokko_sku, address, barrio, list_price_usd, status')
      .eq('status', 'disponible')
      .limit(60)
      .then(r => setAllProperties((r.data ?? []) as DBProperty[]));
  }, [open, lead.id]);

  // Pre-seleccionar la propiedad asociada al lead
  useEffect(() => {
    if (showCreate && lead.propertyId) {
      setPickedProps(new Set([lead.propertyId]));
    }
  }, [showCreate, lead.propertyId]);

  const handleCreate = async () => {
    if (pickedProps.size === 0) return;
    setCreating(true);
    setCreatedUrl(null);
    try {
      const r = await portalsApi.create({
        contact_id: lead.id,
        agent_id: agent.id,
        agent_email: agent.email,
        property_ids: Array.from(pickedProps),
        greeting: greeting.trim() || null,
      });
      setCreatedUrl(r.url);
      await loadAll();
    } catch (e) {
      alert('Error al crear el portal: ' + (e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('No se pudo copiar. Copialo manualmente: ' + url);
    }
  };

  const buildWhatsappMessage = (url: string) => {
    const name = (lead.name ?? '').split(' ')[0];
    const greet = `Hola ${name || ''}`;
    return encodeURIComponent(`${greet}! Te paso el link con la info que charlamos:\n${url}`);
  };

  const activePortal = portals[0];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Generar link del cliente"
        className={`bg-bg-input border ${activePortal ? 'border-emerald-400 text-emerald-500' : 'border-border text-muted hover:border-crimson hover:text-crimson'} px-3 py-3 rounded-xl text-sm transition-colors flex-shrink-0`}
      >
        🔗
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setOpen(false); setShowCreate(false); setCreatedUrl(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-[#0F172A]">🔗 Portal del cliente</div>
                <div className="text-xs text-muted">Link único con propiedades, agenda de visita y tracking en vivo.</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-[#0F172A] text-sm px-2">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {showCreate ? (
                <CreatePortalForm
                  properties={allProperties}
                  pickedProps={pickedProps}
                  setPickedProps={setPickedProps}
                  greeting={greeting}
                  setGreeting={setGreeting}
                  creating={creating}
                  createdUrl={createdUrl}
                  onCancel={() => { setShowCreate(false); setCreatedUrl(null); setGreeting(''); }}
                  onCreate={handleCreate}
                  onCopy={handleCopy}
                  copied={copied}
                  buildWhatsappMessage={buildWhatsappMessage}
                />
              ) : (
                <>
                  <button
                    onClick={() => setShowCreate(true)}
                    className="w-full bg-crimson hover:bg-crimson-light text-white py-3 rounded-xl font-medium text-sm"
                  >
                    + Generar link nuevo
                  </button>

                  {loading ? (
                    <div className="text-center text-muted text-sm py-8">Cargando…</div>
                  ) : portals.length === 0 ? (
                    <div className="text-center text-muted text-sm py-8">
                      Este lead no tiene portal generado aún.
                    </div>
                  ) : (
                    portals.map(p => (
                      <PortalCard
                        key={p.portal_id}
                        portal={p}
                        events={events[p.portal_id] ?? []}
                        onCopy={handleCopy}
                        copied={copied}
                        buildWhatsappMessage={buildWhatsappMessage}
                      />
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const CreatePortalForm = ({
  properties, pickedProps, setPickedProps, greeting, setGreeting,
  creating, createdUrl, onCancel, onCreate, onCopy, copied, buildWhatsappMessage,
}: {
  properties: DBProperty[];
  pickedProps: Set<string>;
  setPickedProps: (s: Set<string>) => void;
  greeting: string;
  setGreeting: (s: string) => void;
  creating: boolean;
  createdUrl: string | null;
  onCancel: () => void;
  onCreate: () => Promise<void>;
  onCopy: (url: string) => Promise<void>;
  copied: boolean;
  buildWhatsappMessage: (url: string) => string;
}) => {
  const [search, setSearch] = useState('');
  const filtered = properties.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (p.tokko_sku ?? '').toLowerCase().includes(q) ||
           (p.address ?? '').toLowerCase().includes(q) ||
           (p.barrio ?? '').toLowerCase().includes(q);
  });

  if (createdUrl) {
    return (
      <div className="space-y-3">
        <div className="text-center py-4">
          <div className="text-5xl mb-2">✅</div>
          <h3 className="font-semibold text-lg text-[#0F172A]">Link generado</h3>
          <p className="text-xs text-muted mt-1">Copialo y pegalo en WhatsApp del cliente.</p>
        </div>
        <div className="bg-bg-soft border border-border rounded-xl p-3">
          <code className="text-xs text-[#0F172A] break-all">{createdUrl}</code>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onCopy(createdUrl)} className="bg-white border border-border py-2 rounded-lg text-sm">
            {copied ? '✓ Copiado' : '📋 Copiar link'}
          </button>
          <a
            href={`https://api.whatsapp.com/send?text=${buildWhatsappMessage(createdUrl)}`}
            target="_blank" rel="noreferrer"
            className="bg-emerald-500 text-white py-2 rounded-lg text-sm text-center"
          >
            💬 Abrir WhatsApp
          </a>
        </div>
        <button onClick={onCancel} className="w-full text-xs text-muted hover:text-[#0F172A] py-2">
          Volver al listado
        </button>
      </div>
    );
  }

  const toggleProp = (id: string) => {
    const next = new Set(pickedProps);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPickedProps(next);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted">Propiedades a incluir ({pickedProps.size} seleccionadas)</label>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por código, dirección o barrio…"
          className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg"
        />
        <div className="mt-2 max-h-64 overflow-y-auto space-y-1 border border-border rounded-lg p-1">
          {filtered.length === 0 ? (
            <div className="text-center text-muted text-xs py-4">Sin resultados</div>
          ) : filtered.map(p => {
            const checked = pickedProps.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggleProp(p.id)}
                className={`w-full text-left p-2 rounded-lg text-sm transition-colors ${checked ? 'bg-crimson/10 border-2 border-crimson' : 'border-2 border-transparent hover:bg-bg-soft'}`}
              >
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={checked} readOnly className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#0F172A] truncate">{p.tokko_sku ?? '—'} · {p.address ?? '—'}</div>
                    <div className="text-xs text-muted truncate">
                      {p.barrio ?? '—'} {p.list_price_usd ? `· USD ${p.list_price_usd.toLocaleString('es-AR')}` : ''}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <label className="block">
        <span className="text-xs text-muted">Saludo personalizado (opcional)</span>
        <textarea
          value={greeting}
          onChange={e => setGreeting(e.target.value)}
          rows={3}
          placeholder="ej: Te preparé este resumen con las 2 opciones que charlamos. Avisame cuál te interesa más."
          className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg resize-none"
        />
      </label>

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 bg-white border border-border py-2 rounded-lg text-sm">
          Cancelar
        </button>
        <button
          onClick={onCreate}
          disabled={pickedProps.size === 0 || creating}
          className="flex-1 bg-crimson text-white py-2 rounded-lg text-sm disabled:opacity-40"
        >
          {creating ? 'Creando…' : `Crear link (${pickedProps.size})`}
        </button>
      </div>
    </div>
  );
};

const PortalCard = ({ portal, events, onCopy, copied, buildWhatsappMessage }: {
  portal: PortalSummary;
  events: PortalEvent[];
  onCopy: (url: string) => Promise<void>;
  copied: boolean;
  buildWhatsappMessage: (url: string) => string;
}) => {
  const baseUrl = window.location.origin;
  const url = `${baseUrl}/c/${portal.token}`;
  const expired = new Date(portal.expires_at).getTime() < Date.now();

  return (
    <div className={`border rounded-xl p-3 ${portal.is_active && !expired ? 'border-emerald-300 bg-emerald-50/30' : 'border-border bg-slate-50'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-[#0F172A] bg-white px-2 py-0.5 rounded border border-border">{portal.token}</span>
            {!portal.is_active ? (
              <span className="text-[10px] text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">desactivado</span>
            ) : expired ? (
              <span className="text-[10px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">expirado</span>
            ) : (
              <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">activo</span>
            )}
            <span className="text-[10px] text-muted">{portal.property_ids.length} props</span>
          </div>
          <div className="text-[10px] text-muted mt-1">
            Creado {formatDistanceToNow(new Date(portal.created_at), { addSuffix: true, locale: es })} · {portal.view_count} {portal.view_count === 1 ? 'visita' : 'visitas'}
            {portal.last_viewed_at && ` · última ${formatDistanceToNow(new Date(portal.last_viewed_at), { addSuffix: true, locale: es })}`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 mb-2">
        <button onClick={() => onCopy(url)} className="bg-white border border-border py-1.5 rounded text-xs">
          {copied ? '✓ Copiado' : '📋 Copiar'}
        </button>
        <a
          href={`https://api.whatsapp.com/send?text=${buildWhatsappMessage(url)}`}
          target="_blank" rel="noreferrer"
          className="bg-emerald-500 text-white py-1.5 rounded text-xs text-center"
        >
          💬 WhatsApp
        </a>
      </div>

      {events.length > 0 && (
        <div className="mt-2 pt-2 border-t border-emerald-200/50">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">Actividad del cliente</div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {events.map(ev => {
              const meta = EVENT_LABEL[ev.event_type] ?? { emoji: '•', label: ev.event_type };
              return (
                <div key={ev.id} className="text-xs flex items-center gap-2">
                  <span className="flex-shrink-0">{meta.emoji}</span>
                  <span className="text-[#0F172A] flex-1 truncate">{meta.label}</span>
                  <span className="text-[10px] text-muted flex-shrink-0">
                    {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true, locale: es })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
