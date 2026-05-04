import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useApp } from '../contexts/AppContext';
import { Modal } from '../components/ui/Modal';
import {
  EXPENSE_CATEGORIES,
  expensesApi,
  cashflowApi,
  fmtARS,
  fmtDate,
  monthLabel,
  currentYearMonth,
  type CashflowMonthly,
  type DBExpense,
} from '../services/commissions';

const todayISO = () => new Date().toISOString().slice(0, 10);

const yearMonthOptions = (count = 12): string[] => {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
};

export default function Finanzas() {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';

  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [expenses, setExpenses] = useState<DBExpense[]>([]);
  const [allExpenses, setAllExpenses] = useState<DBExpense[]>([]);
  const [cashflow, setCashflow] = useState<CashflowMonthly[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'resumen' | 'gastos'>('resumen');

  // Form
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState({
    fecha: todayISO(),
    category: 'marketing',
    description: '',
    amount_ars: '',
    payment_method: 'transferencia',
    paid_to: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [sendingSummary, setSendingSummary] = useState(false);

  const sendMonthlySummary = async () => {
    if (!confirm(`Enviar el resumen del mes seleccionado (${monthLabel(yearMonth)}) por WhatsApp al admin?`)) return;
    setSendingSummary(true);
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/monthly-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON}`, 'apikey': ANON },
        body: JSON.stringify({ yearMonth }),
      });
      const result = await resp.json();
      if (result.ok) {
        alert(`Resumen enviado por WhatsApp a ${result.phone ?? 'admin'}`);
      } else {
        alert('Error: ' + (result.error ?? 'desconocido'));
      }
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setSendingSummary(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const [exp, all, cf] = await Promise.all([
        expensesApi.listForMonth(yearMonth),
        expensesApi.list(),
        cashflowApi.monthly(),
      ]);
      setExpenses(exp);
      setAllExpenses(all);
      setCashflow(cf);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [yearMonth]);

  const monthExpensesTotal = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.amount_ars), 0),
    [expenses]
  );

  const expensesByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount_ars));
    }
    return Array.from(map.entries())
      .map(([cat, total]) => ({
        cat,
        label: EXPENSE_CATEGORIES.find(c => c.key === cat)?.label ?? cat,
        total,
      }))
      .sort((a, b) => b.total - a.total);
  }, [expenses]);

  // Chart: últimos 6 meses egresos por mes
  const chartData = useMemo(() => {
    const months = yearMonthOptions(6).reverse();
    return months.map(m => {
      const mDate = `${m}-01`;
      const exp = cashflow
        .filter(c => c.kind === 'expense' && c.mes.startsWith(m))
        .reduce((s, c) => s + Number(c.total_ars), 0);
      const inc = cashflow
        .filter(c => c.kind === 'income' && c.mes.startsWith(m))
        .reduce((s, c) => s + Number(c.total_ars), 0);
      return { mes: monthLabel(m).slice(0, 3), Gastos: exp, Ingresos: inc, _key: mDate };
    });
  }, [cashflow]);

  const handleSave = async () => {
    if (!draft.description || !draft.amount_ars) {
      alert('Completá descripción y monto.');
      return;
    }
    setSaving(true);
    try {
      await expensesApi.create({
        fecha: draft.fecha,
        category: draft.category,
        description: draft.description,
        amount_ars: Number(draft.amount_ars),
        payment_method: draft.payment_method || null,
        paid_to: draft.paid_to || null,
        related_operation_id: null,
        related_property_id: null,
        receipt_url: null,
        notes: draft.notes || null,
        created_by: currentUser.id,
      });
      setModalOpen(false);
      setDraft({
        fecha: todayISO(),
        category: 'marketing',
        description: '',
        amount_ars: '',
        payment_method: 'transferencia',
        paid_to: '',
        notes: '',
      });
      await refresh();
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este gasto?')) return;
    await expensesApi.remove(id);
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

  return (
    <div className="p-5 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Finanzas</h1>
          <p className="text-muted text-sm mt-0.5 capitalize">{monthLabel(yearMonth)}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void sendMonthlySummary()}
            disabled={sendingSummary}
            className="px-4 py-2.5 inline-flex items-center gap-2 bg-white border border-border text-[#0F172A] hover:bg-bg-hover rounded-xl text-sm font-medium transition-all disabled:opacity-60"
            title="Enviá un resumen del mes anterior por WhatsApp"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            {sendingSummary ? 'Enviando…' : 'Enviar resumen WhatsApp'}
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-2.5 bg-crimson hover:bg-crimson-bright text-white rounded-xl text-sm font-medium transition-all"
          >
            + Cargar gasto
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted mb-1 block">Mes</label>
          <select
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
          >
            {yearMonthOptions(18).map(ym => (
              <option key={ym} value={ym} className="capitalize">{monthLabel(ym)}</option>
            ))}
          </select>
        </div>
        <div className="flex bg-white border border-border rounded-xl overflow-hidden">
          {(['resumen', 'gastos'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-all ${tab === t ? 'bg-crimson text-white' : 'text-[#475569] hover:text-[#0F172A]'}`}
            >
              {t === 'resumen' ? 'Resumen' : 'Gastos'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'resumen' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-white border border-border rounded-2xl p-5">
              <div className="text-muted text-xs uppercase tracking-wider mb-1">Gastos del mes</div>
              <div className="text-2xl font-bold text-red-600">{fmtARS(monthExpensesTotal)}</div>
              <div className="text-xs text-muted mt-0.5">{expenses.length} movimiento{expenses.length === 1 ? '' : 's'}</div>
            </div>
            <div className="bg-white border border-border rounded-2xl p-5">
              <div className="text-muted text-xs uppercase tracking-wider mb-1">Categorías activas</div>
              <div className="text-2xl font-bold text-[#0F172A]">{expensesByCategory.length}</div>
            </div>
            <div className="bg-white border border-border rounded-2xl p-5">
              <div className="text-muted text-xs uppercase tracking-wider mb-1">Top categoría</div>
              <div className="text-base font-semibold text-[#0F172A] truncate">{expensesByCategory[0]?.label ?? '—'}</div>
              <div className="text-xs text-muted mt-0.5">{expensesByCategory[0] ? fmtARS(expensesByCategory[0].total) : ''}</div>
            </div>
          </div>

          {/* Chart 6 meses */}
          <div className="bg-white border border-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-[#0F172A] mb-3">Cashflow últimos 6 meses</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="mes" tick={{ fill: '#64748B', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} />
                  <Tooltip formatter={(v) => fmtARS(Number(v))} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Ingresos" fill="#10B981" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Gastos" fill="#EF4444" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Por categoría */}
          {expensesByCategory.length > 0 && (
            <div className="bg-white border border-border rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-3">Distribución por categoría</h3>
              <div className="space-y-2">
                {expensesByCategory.map(c => {
                  const pct = (c.total / monthExpensesTotal) * 100;
                  return (
                    <div key={c.cat}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[#475569]">{c.label}</span>
                        <span className="text-[#0F172A] font-semibold tabular-nums">{fmtARS(c.total)} · {pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-bg-input rounded-full overflow-hidden">
                        <div className="h-full bg-crimson rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'gastos' && (
        <div className="bg-white border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-bg-hover">
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Categoría</th>
                  <th className="px-4 py-3 font-medium">Descripción</th>
                  <th className="px-4 py-3 font-medium">Pagado a</th>
                  <th className="px-4 py-3 font-medium">Método</th>
                  <th className="px-4 py-3 font-medium text-right">Monto ARS</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted text-sm">Cargando…</td></tr>
                )}
                {!loading && expenses.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted text-sm">Sin gastos cargados este mes.</td></tr>
                )}
                {expenses.map(e => {
                  const cat = EXPENSE_CATEGORIES.find(c => c.key === e.category);
                  return (
                    <tr key={e.id} className="hover:bg-bg-hover transition-colors">
                      <td className="px-4 py-3 text-sm text-[#0F172A]">{fmtDate(e.fecha)}</td>
                      <td className="px-4 py-3 text-sm text-[#0F172A]">{cat?.label ?? e.category}</td>
                      <td className="px-4 py-3 text-sm text-[#0F172A]">{e.description}</td>
                      <td className="px-4 py-3 text-sm text-muted">{e.paid_to ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-muted capitalize">{e.payment_method ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-right text-[#0F172A] font-semibold tabular-nums">{fmtARS(Number(e.amount_ars))}</td>
                      <td className="px-4 py-3 text-sm text-right">
                        <button
                          onClick={() => void handleDelete(e.id)}
                          className="text-xs px-2 py-1 rounded-md text-red-600 hover:bg-red-50 border border-red-200"
                        >
                          Borrar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {expenses.length > 0 && (
                <tfoot className="bg-bg-hover">
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-sm font-medium text-[#0F172A]">Total del mes</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-crimson tabular-nums">{fmtARS(monthExpensesTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Modal cargar gasto */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Cargar gasto" width="max-w-xl">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Fecha</label>
              <input
                type="date"
                value={draft.fecha}
                onChange={(e) => setDraft({ ...draft, fecha: e.target.value })}
                className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Categoría</label>
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              >
                {EXPENSE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Descripción *</label>
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              placeholder="Ej: Pauta Meta abril"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Monto ARS *</label>
              <input
                type="number"
                value={draft.amount_ars}
                onChange={(e) => setDraft({ ...draft, amount_ars: e.target.value })}
                className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                placeholder="350000"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Método</label>
              <select
                value={draft.payment_method}
                onChange={(e) => setDraft({ ...draft, payment_method: e.target.value })}
                className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              >
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="cheque">Cheque</option>
                <option value="mp">Mercado Pago</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Pagado a (proveedor)</label>
            <input
              value={draft.paid_to}
              onChange={(e) => setDraft({ ...draft, paid_to: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              placeholder="Ej: Meta Platforms"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Notas</label>
            <input
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
            />
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

      <p className="text-[10px] text-muted">
        {allExpenses.length} gastos totales acumulados en el sistema
      </p>
    </div>
  );
}
