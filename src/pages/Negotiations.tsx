import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Modal } from '../components/ui/Modal';
import {
  agentsApi,
  contactsLiteApi,
  negotiationsApi,
  propertiesApi,
  fmtDate,
  fmtUSD,
  type ContactLite,
  type DBAgent,
  type DBProperty,
  type NegotiationWithRefs,
} from '../services/commissions';

type CloseReason = 'venta' | 'cliente_no_quiso' | 'precio' | 'otro';

const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  venta: 'Cerró en venta',
  cliente_no_quiso: 'Cliente no quiso',
  precio: 'No acordamos precio',
  otro: 'Otro motivo',
};

export default function Negotiations() {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';

  const [agents, setAgents] = useState<DBAgent[]>([]);
  const [properties, setProperties] = useState<DBProperty[]>([]);
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [negotiations, setNegotiations] = useState<NegotiationWithRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'activa' | 'cerrada' | 'caida' | 'all'>('activa');

  const [newOpen, setNewOpen] = useState(false);
  const [draftPropId, setDraftPropId] = useState('');
  const [draftContactId, setDraftContactId] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [closeModal, setCloseModal] = useState<{ neg: NegotiationWithRefs; reason: CloseReason; notes: string } | null>(null);

  const myAgentId = useMemo(
    () => agents.find(a => a.email === currentUser.email)?.id ?? null,
    [agents, currentUser.email],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const [a, p, c] = await Promise.all([
        agentsApi.list(),
        propertiesApi.list(),
        contactsLiteApi.list(),
      ]);
      setAgents(a);
      setProperties(p);
      setContacts(c);
      const me = a.find(x => x.email === currentUser.email);
      const negs = isAdmin
        ? await negotiationsApi.listActive()
        : me ? await negotiationsApi.listForAgent(me.id) : [];
      setNegotiations(negs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [currentUser.email]);

  const filtered = useMemo(() => {
    return negotiations.filter(n => {
      if (filterStatus !== 'all' && n.status !== filterStatus) return false;
      if (isAdmin && filterAgent !== 'all' && n.agent_id !== filterAgent) return false;
      return true;
    });
  }, [negotiations, filterStatus, filterAgent, isAdmin]);

  const sellableAgents = useMemo(() => agents.filter(a => a.role === 'agent' && a.active), [agents]);

  const create = async () => {
    if (!myAgentId && !isAdmin) {
      alert('No pudimos identificar tu perfil de vendedor. Avisale a Leticia.');
      return;
    }
    if (!draftPropId) {
      alert('Elegí una propiedad.');
      return;
    }
    setSaving(true);
    try {
      await negotiationsApi.create({
        property_id: draftPropId,
        agent_id: myAgentId ?? agents.find(a => a.role === 'agent')?.id ?? '',
        contact_id: draftContactId || null,
        notes: draftNotes || undefined,
      });
      setDraftPropId('');
      setDraftContactId('');
      setDraftNotes('');
      setNewOpen(false);
      await refresh();
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const closeNegotiation = async () => {
    if (!closeModal) return;
    try {
      await negotiationsApi.close(closeModal.neg.id, {
        reason: closeModal.reason,
        notes: closeModal.notes || undefined,
      });
      setCloseModal(null);
      await refresh();
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    }
  };

  // Negociaciones agrupadas por agente para el resumen del admin
  const byAgent = useMemo(() => {
    const map = new Map<string, NegotiationWithRefs[]>();
    for (const n of negotiations.filter(x => x.status === 'activa')) {
      const key = n.agent_id;
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([agentId, items]) => ({
        agent: agents.find(a => a.id === agentId),
        count: items.length,
      }))
      .sort((a, b) => b.count - a.count);
  }, [negotiations, agents]);

  return (
    <div className="p-5 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Negociaciones</h1>
          <p className="text-muted text-sm mt-0.5">
            {isAdmin
              ? 'Propiedades en negociación por todo el equipo'
              : 'Tus propiedades en negociación. Marcá acá las que estás manejando para que Leti las vea.'}
          </p>
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="px-4 py-2.5 bg-crimson hover:bg-crimson-bright text-white rounded-xl text-sm font-medium transition-all"
        >
          + Nueva negociación
        </button>
      </div>

      {/* Resumen para admin: cuántas tiene cada vendedor */}
      {isAdmin && byAgent.length > 0 && filterStatus === 'activa' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {byAgent.map(b => (
            <button
              key={b.agent?.id}
              onClick={() => setFilterAgent(prev => prev === b.agent?.id ? 'all' : (b.agent?.id ?? 'all'))}
              className={`text-left bg-white border-2 rounded-2xl p-4 transition-all ${
                filterAgent === b.agent?.id ? 'border-crimson' : 'border-border hover:border-border'
              }`}
            >
              <div className="text-xs text-muted mb-1">{b.agent?.name ?? '—'}</div>
              <div className="text-2xl font-bold text-[#0F172A]">{b.count}</div>
              <div className="text-xs text-muted mt-0.5">activa{b.count === 1 ? '' : 's'}</div>
            </button>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        {(['activa', 'cerrada', 'caida', 'all'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
              filterStatus === s
                ? 'bg-crimson text-white border-crimson'
                : 'bg-white text-[#0F172A] border-border hover:bg-bg-hover'
            }`}
          >
            {s === 'all' ? 'Todas' : s === 'activa' ? 'Activas' : s === 'cerrada' ? 'Cerradas (venta)' : 'Caídas'}
          </button>
        ))}
        {isAdmin && (
          <select
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            className="bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A] ml-auto"
          >
            <option value="all">Todos los vendedores</option>
            {sellableAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-hover">
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Inicio</th>
                <th className="px-4 py-3 font-medium">Propiedad</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                {isAdmin && <th className="px-4 py-3 font-medium">Vendedor</th>}
                <th className="px-4 py-3 font-medium">Notas</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-muted text-sm">Cargando…</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-muted text-sm">
                  Sin negociaciones {filterStatus !== 'all' ? `(${filterStatus})` : ''}.
                </td></tr>
              )}
              {filtered.map(n => (
                <tr key={n.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-3 text-sm text-[#0F172A]">{fmtDate(n.created_at.slice(0, 10))}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="text-[#0F172A] font-medium">{n.property?.address ?? '—'}</div>
                    {n.property?.list_price_usd != null && (
                      <div className="text-muted text-xs">{fmtUSD(Number(n.property.list_price_usd))}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {n.contact ? (
                      <div>
                        <div className="text-[#0F172A]">{n.contact.name ?? 'Sin nombre'}</div>
                        {n.contact.phone && <div className="text-muted text-xs">{n.contact.phone}</div>}
                      </div>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-sm text-[#0F172A]">{n.agent?.name ?? '—'}</td>
                  )}
                  <td className="px-4 py-3 text-sm text-muted max-w-xs truncate" title={n.notes ?? ''}>{n.notes ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">
                    {n.status === 'activa' && <span className="inline-block px-2 py-1 bg-amber-100 text-amber-700 border border-amber-200 rounded-md text-xs font-medium">Activa</span>}
                    {n.status === 'cerrada' && <span className="inline-block px-2 py-1 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-md text-xs font-medium">Vendida ✓</span>}
                    {n.status === 'caida' && (
                      <span className="inline-block px-2 py-1 bg-red-100 text-red-700 border border-red-200 rounded-md text-xs font-medium" title={n.closed_reason ?? ''}>
                        Caída
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {n.status === 'activa' && (n.agent_id === myAgentId || isAdmin) && (
                      <button
                        onClick={() => setCloseModal({ neg: n, reason: 'venta', notes: '' })}
                        className="text-xs px-3 py-1.5 rounded-md border border-border text-[#475569] hover:bg-bg-hover transition-all"
                      >
                        Cerrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal nueva negociación */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Marcar propiedad en negociación" width="max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Propiedad *</label>
            <select
              value={draftPropId}
              onChange={(e) => setDraftPropId(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
            >
              <option value="">— Elegir propiedad —</option>
              {properties.filter(p => p.status === 'disponible').map(p => (
                <option key={p.id} value={p.id}>
                  {p.address} {p.list_price_usd ? `· ${fmtUSD(Number(p.list_price_usd))}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Cliente (opcional)</label>
            <select
              value={draftContactId}
              onChange={(e) => setDraftContactId(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
            >
              <option value="">— Sin asignar —</option>
              {contacts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name ?? 'Sin nombre'} {c.phone ? `· ${c.phone}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Notas</label>
            <textarea
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              rows={3}
              placeholder="Ej: Cliente vio la propiedad el lunes, ofertó 130k. Estoy esperando contraoferta del dueño."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setNewOpen(false)}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-xl border border-border text-[#475569] hover:bg-bg-hover transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={() => void create()}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-xl bg-crimson text-white hover:bg-crimson-bright transition-all disabled:opacity-60"
            >
              {saving ? 'Guardando…' : 'Marcar en negociación'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal cerrar negociación */}
      <Modal open={!!closeModal} onClose={() => setCloseModal(null)} title="Cerrar negociación" width="max-w-md">
        {closeModal && (
          <div className="space-y-4">
            <div className="bg-bg-hover rounded-xl p-3 text-sm">
              <div className="font-medium text-[#0F172A]">{closeModal.neg.property?.address ?? '—'}</div>
              {closeModal.neg.contact?.name && <div className="text-muted text-xs">Cliente: {closeModal.neg.contact.name}</div>}
            </div>
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">¿Cómo terminó? *</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(CLOSE_REASON_LABEL) as CloseReason[]).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCloseModal({ ...closeModal, reason: r })}
                    className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all text-left ${
                      closeModal.reason === r
                        ? 'bg-crimson text-white border-crimson'
                        : 'bg-white text-[#0F172A] border-border hover:bg-bg-hover'
                    }`}
                  >
                    {CLOSE_REASON_LABEL[r]}
                  </button>
                ))}
              </div>
              {closeModal.reason === 'venta' && (
                <p className="text-xs text-muted mt-2">⚠️ Acordate de cargar la venta en "Operaciones" para que se calcule la comisión.</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Notas (opcional)</label>
              <textarea
                value={closeModal.notes}
                onChange={(e) => setCloseModal({ ...closeModal, notes: e.target.value })}
                className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setCloseModal(null)}
                className="px-4 py-2 text-sm rounded-xl border border-border text-[#475569] hover:bg-bg-hover transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={() => void closeNegotiation()}
                className="px-4 py-2 text-sm rounded-xl bg-crimson text-white hover:bg-crimson-bright transition-all"
              >
                Cerrar negociación
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
