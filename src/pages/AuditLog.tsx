import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../services/supabase';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';

interface AuditEntry {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  context: string | null;
}

const ACTION_META: Record<string, { emoji: string; label: string; color: string }> = {
  lead_assigned: { emoji: '🎯', label: 'Lead asignado', color: 'bg-blue-50 text-blue-700' },
  lead_reassigned: { emoji: '🔄', label: 'Lead reasignado', color: 'bg-amber-50 text-amber-700' },
  stage_changed: { emoji: '➡️', label: 'Cambio de etapa', color: 'bg-violet-50 text-violet-700' },
  operation_created: { emoji: '📄', label: 'Venta cargada', color: 'bg-emerald-50 text-emerald-700' },
  operation_approved: { emoji: '✅', label: 'Venta aprobada', color: 'bg-emerald-50 text-emerald-700' },
  operation_rejected: { emoji: '❌', label: 'Venta rechazada', color: 'bg-rose-50 text-rose-700' },
  operation_paid: { emoji: '💸', label: 'Venta pagada', color: 'bg-emerald-50 text-emerald-700' },
  operation_status_changed: { emoji: '🔁', label: 'Status venta', color: 'bg-slate-50 text-slate-700' },
  negotiation_started: { emoji: '🤝', label: 'Negociación abierta', color: 'bg-blue-50 text-blue-700' },
  negotiation_won: { emoji: '🏆', label: 'Negociación cerrada', color: 'bg-emerald-50 text-emerald-700' },
  negotiation_lost: { emoji: '💔', label: 'Negociación caída', color: 'bg-rose-50 text-rose-700' },
};

const FILTERS = [
  { key: 'all', label: 'Todo' },
  { key: 'leads', label: 'Leads', actions: ['lead_assigned', 'lead_reassigned', 'stage_changed'] },
  { key: 'operations', label: 'Ventas', actions: ['operation_created', 'operation_approved', 'operation_rejected', 'operation_paid', 'operation_status_changed'] },
  { key: 'negotiations', label: 'Negociaciones', actions: ['negotiation_started', 'negotiation_won', 'negotiation_lost'] },
];

export default function AuditLog() {
  const { currentUser } = useApp();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('v_audit_log')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(500);
      setEntries((data ?? []) as AuditEntry[]);
      setLoading(false);
    };
    void load();
  }, [currentUser.role]);

  const filtered = useMemo(() => {
    let list = entries;
    const f = FILTERS.find(x => x.key === filter);
    if (f && 'actions' in f && f.actions) {
      list = list.filter(e => f.actions!.includes(e.action));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.actor_name ?? '').toLowerCase().includes(q) ||
        (e.entity_label ?? '').toLowerCase().includes(q) ||
        (e.action ?? '').toLowerCase().includes(q) ||
        (e.context ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [entries, filter, search]);

  if (currentUser.role !== 'admin') {
    return (
      <div className="p-6">
        <div className="bg-white border border-border rounded-2xl p-4 text-sm text-muted">
          Esta sección es solo para administradores.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <PageHeader
        title="Audit log"
        subtitle={`Registro inmutable de acciones críticas en el CRM. Quién hizo qué, cuándo. ${entries.length} eventos cargados.`}
      />

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${filter === f.key ? 'bg-crimson text-white' : 'bg-white border border-border text-muted hover:bg-bg-soft'}`}
          >
            {f.label}
          </button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por actor, entidad…"
          className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-border rounded-full bg-white"
        />
      </div>

      {loading ? (
        <div className="text-muted text-sm py-12 text-center animate-pulse">Cargando…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📜"
          title="Sin eventos"
          description="No hay registros que matcheen los filtros aplicados. Probá cambiar la categoría o limpiar el buscador."
        />
      ) : (
        <div className="space-y-1">
          {filtered.map((e, i) => {
            const meta = ACTION_META[e.action] ?? { emoji: '•', label: e.action, color: 'bg-slate-50 text-slate-700' };
            const showDate = i === 0 || format(new Date(filtered[i-1].occurred_at), 'yyyy-MM-dd') !== format(new Date(e.occurred_at), 'yyyy-MM-dd');
            return (
              <div key={e.id}>
                {showDate && (
                  <div className="text-xs text-muted font-semibold uppercase mt-3 mb-2 sticky top-0 bg-bg-main py-1">
                    {format(new Date(e.occurred_at), "EEEE d 'de' MMMM yyyy", { locale: es })}
                  </div>
                )}
                <div className="bg-white border border-border rounded-xl p-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5 text-2xl">{meta.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.color} font-medium`}>
                          {meta.label}
                        </span>
                        {e.entity_label && <span className="text-sm font-medium text-[#0F172A] truncate">{e.entity_label}</span>}
                      </div>
                      <div className="text-xs text-muted mt-1">
                        {e.actor_name ? <span className="font-medium">{e.actor_name}</span> : <span className="italic">sistema</span>}
                        {' · '}
                        <time>{formatDistanceToNow(new Date(e.occurred_at), { addSuffix: true, locale: es })}</time>
                        {' · '}
                        <time>{format(new Date(e.occurred_at), 'HH:mm')}</time>
                      </div>
                      {e.context && (
                        <div className="text-xs text-rose-700 bg-rose-50 px-2 py-1 rounded mt-1 inline-block">{e.context}</div>
                      )}
                      {(e.before_data || e.after_data) && (
                        <DiffPreview before={e.before_data} after={e.after_data} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const DiffPreview = ({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) => {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  if (keys.size === 0) return null;
  return (
    <div className="mt-2 text-[11px] text-muted space-y-0.5">
      {Array.from(keys).map(k => {
        const b = (before as Record<string, unknown> | null)?.[k];
        const a = (after as Record<string, unknown> | null)?.[k];
        if (b === a) return null;
        return (
          <div key={k} className="flex gap-1.5 items-baseline">
            <span className="font-mono text-slate-400">{k}:</span>
            {b !== undefined && b !== null && b !== '' && <span className="line-through text-slate-500">{String(b).slice(0, 60)}</span>}
            {a !== undefined && a !== null && a !== '' && <span className="text-emerald-700">→ {String(a).slice(0, 60)}</span>}
          </div>
        );
      })}
    </div>
  );
};
