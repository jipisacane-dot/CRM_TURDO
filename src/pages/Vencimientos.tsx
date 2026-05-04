import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Modal } from '../components/ui/Modal';
import {
  expirationsApi,
  EXPIRATION_TYPE_LABEL,
  fmtDate,
  type DBExpiration,
} from '../services/commissions';

const todayISO = () => new Date().toISOString().slice(0, 10);

const daysUntil = (date: string): number => {
  const d = new Date(date + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
};

const urgencyClass = (days: number): string => {
  if (days < 0) return 'bg-red-100 text-red-700 border-red-200';
  if (days <= 3) return 'bg-amber-100 text-amber-700 border-amber-200';
  if (days <= 14) return 'bg-sky-100 text-sky-700 border-sky-200';
  return 'bg-bg-hover text-[#475569] border-border';
};

export default function Vencimientos() {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';

  const [items, setItems] = useState<DBExpiration[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState({
    type: 'otro',
    title: '',
    description: '',
    due_date: todayISO(),
    notify_days_before: '7',
  });
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = showResolved ? await expirationsApi.listAll() : await expirationsApi.listPending();
      setItems(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [showResolved]);

  const grouped = useMemo(() => {
    const overdue: DBExpiration[] = [];
    const upcoming: DBExpiration[] = [];
    const future: DBExpiration[] = [];
    const resolved: DBExpiration[] = [];
    for (const e of items) {
      if (e.resolved) {
        resolved.push(e);
      } else {
        const d = daysUntil(e.due_date);
        if (d < 0) overdue.push(e);
        else if (d <= 14) upcoming.push(e);
        else future.push(e);
      }
    }
    return { overdue, upcoming, future, resolved };
  }, [items]);

  const handleSave = async () => {
    if (!draft.title || !draft.due_date) {
      alert('Completá título y fecha.');
      return;
    }
    setSaving(true);
    try {
      await expirationsApi.create({
        type: draft.type,
        title: draft.title,
        description: draft.description || null,
        due_date: draft.due_date,
        notify_days_before: Number(draft.notify_days_before) || 7,
      });
      setDraft({ type: 'otro', title: '', description: '', due_date: todayISO(), notify_days_before: '7' });
      setModalOpen(false);
      await refresh();
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleResolve = async (id: string) => {
    await expirationsApi.resolve(id, currentUser.id);
    await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este vencimiento?')) return;
    await expirationsApi.remove(id);
    await refresh();
  };

  if (!isAdmin) {
    return (
      <div className="p-5 md:p-8">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <p className="text-amber-900 font-medium">Esta vista es exclusiva para Leticia (admin).</p>
        </div>
      </div>
    );
  }

  const Section = ({ label, items, color }: { label: string; items: DBExpiration[]; color: string }) => {
    if (items.length === 0) return null;
    return (
      <div>
        <h3 className={`text-sm font-semibold mb-2 ${color}`}>{label} · {items.length}</h3>
        <div className="space-y-2">
          {items.map(e => {
            const d = daysUntil(e.due_date);
            const cls = urgencyClass(d);
            const whenText = e.resolved
              ? 'Resuelto'
              : d < 0
              ? `Vencido hace ${-d} día${-d === 1 ? '' : 's'}`
              : d === 0
              ? 'Vence hoy'
              : d === 1
              ? 'Vence mañana'
              : `Vence en ${d} días`;
            return (
              <div key={e.id} className="bg-white border border-border rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border font-medium ${cls}`}>
                      {EXPIRATION_TYPE_LABEL[e.type] ?? e.type}
                    </span>
                    <span className="text-xs text-muted">{fmtDate(e.due_date)} · {whenText}</span>
                  </div>
                  <div className="text-sm font-medium text-[#0F172A]">{e.title}</div>
                  {e.description && <div className="text-xs text-muted mt-0.5">{e.description}</div>}
                </div>
                <div className="flex gap-2">
                  {!e.resolved && (
                    <button
                      onClick={() => void handleResolve(e.id)}
                      className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-all"
                    >
                      Resolver
                    </button>
                  )}
                  <button
                    onClick={() => void handleDelete(e.id)}
                    className="text-xs px-2 py-1.5 rounded-md text-red-600 hover:bg-red-50 border border-red-200"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="p-5 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Vencimientos</h1>
          <p className="text-muted text-sm mt-0.5">Escrituras, contratos, seguros y otros eventos próximos</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowResolved(s => !s)}
            className="px-3 py-2 text-sm rounded-xl border border-border bg-white text-[#475569] hover:bg-bg-hover transition-all"
          >
            {showResolved ? 'Ocultar resueltos' : 'Ver resueltos'}
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-2.5 bg-crimson hover:bg-crimson-bright text-white rounded-xl text-sm font-medium transition-all"
          >
            + Cargar vencimiento
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-border rounded-2xl p-4">
          <div className="text-muted text-xs uppercase tracking-wider mb-1">Vencidos</div>
          <div className="text-2xl font-bold text-red-600">{grouped.overdue.length}</div>
        </div>
        <div className="bg-white border border-border rounded-2xl p-4">
          <div className="text-muted text-xs uppercase tracking-wider mb-1">Próximos 14d</div>
          <div className="text-2xl font-bold text-amber-600">{grouped.upcoming.length}</div>
        </div>
        <div className="bg-white border border-border rounded-2xl p-4">
          <div className="text-muted text-xs uppercase tracking-wider mb-1">Más adelante</div>
          <div className="text-2xl font-bold text-sky-600">{grouped.future.length}</div>
        </div>
        <div className="bg-white border border-border rounded-2xl p-4">
          <div className="text-muted text-xs uppercase tracking-wider mb-1">Resueltos</div>
          <div className="text-2xl font-bold text-emerald-600">{grouped.resolved.length}</div>
        </div>
      </div>

      {loading && <div className="text-center text-muted text-sm py-8">Cargando…</div>}
      {!loading && (
        <div className="space-y-6">
          <Section label="Vencidos" items={grouped.overdue} color="text-red-600" />
          <Section label="Próximos 14 días" items={grouped.upcoming} color="text-amber-700" />
          <Section label="Más adelante" items={grouped.future} color="text-sky-700" />
          {showResolved && <Section label="Resueltos" items={grouped.resolved} color="text-emerald-600" />}
          {items.length === 0 && (
            <div className="bg-white border border-border rounded-2xl p-8 text-center">
              <div className="text-muted text-sm">Sin vencimientos cargados.</div>
              <div className="text-muted text-xs mt-1">Cuando cargues operaciones con fecha de escritura, aparecen acá automáticamente.</div>
            </div>
          )}
        </div>
      )}

      {/* Modal cargar vencimiento */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Cargar vencimiento">
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Tipo</label>
            <select
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
            >
              {Object.entries(EXPIRATION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Título *</label>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              placeholder="Ej: Renovación seguro de caución"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Descripción</label>
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              placeholder="Detalles"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Fecha *</label>
              <input
                type="date"
                value={draft.due_date}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Avisar días antes</label>
              <input
                type="number"
                value={draft.notify_days_before}
                onChange={(e) => setDraft({ ...draft, notify_days_before: e.target.value })}
                className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-xl border border-border text-[#475569] hover:bg-bg-hover transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-xl bg-crimson text-white hover:bg-crimson-bright transition-all disabled:opacity-60"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
