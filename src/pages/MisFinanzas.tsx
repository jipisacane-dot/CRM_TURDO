import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Modal } from '../components/ui/Modal';
import {
  type Currency,
  type FinanceMovement,
  type FinanceScope,
  type FinanceType,
  PERSONAL_CATEGORIES,
  BRANCH_EXPENSE_CATEGORIES,
  BRANCH_INCOME_CATEGORIES,
  calcMonthlyTotals,
  categoryLabel,
  createMovement,
  deleteMovement,
  formatUSD,
  formatARS,
  getBlueRate,
  listMovements,
  parseFinanceText,
  type BlueRate,
} from '../services/finances';

type TabKey = 'personal' | 'corrientes' | 'alem';

const TABS: Array<{ key: TabKey; label: string; scope: FinanceScope; scope_id: string }> = [
  { key: 'personal',   label: 'Personal',   scope: 'personal', scope_id: 'leticia' },
  { key: 'corrientes', label: 'Corrientes', scope: 'branch',   scope_id: 'corrientes' },
  { key: 'alem',       label: 'Alem',       scope: 'branch',   scope_id: 'alem' },
];

const todayISO = () => new Date().toISOString().slice(0, 10);

const monthBounds = (yearMonth: string) => {
  const [y, m] = yearMonth.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    start: `${yearMonth}-01`,
    end: `${yearMonth}-${String(last).padStart(2, '0')}`,
  };
};

const currentYearMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const yearMonthOptions = (count = 12): string[] => {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
};

const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
};

export default function MisFinanzas() {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';

  const [tab, setTab] = useState<TabKey>('personal');
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [movements, setMovements] = useState<FinanceMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [blueRate, setBlueRate] = useState<BlueRate | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    type: 'expense' as FinanceType,
    category: 'comida',
    amount: '',
    currency: 'ARS' as Currency,
    description: '',
    movement_date: todayISO(),
  });

  const activeTab = TABS.find(t => t.key === tab)!;

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const { start, end } = monthBounds(yearMonth);
      const data = await listMovements({
        scope: activeTab.scope,
        scope_id: activeTab.scope_id,
        monthStart: start,
        monthEnd: end,
      });
      setMovements(data);
    } catch (e) {
      console.error('listMovements err', e);
    } finally {
      setLoading(false);
    }
  }, [activeTab.scope, activeTab.scope_id, yearMonth, isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!isAdmin) return;
    getBlueRate().then(setBlueRate).catch(() => null);
  }, [isAdmin]);

  const totals = useMemo(() => calcMonthlyTotals(movements), [movements]);

  // Category list according to current tab + type
  const categoryOptions = useMemo(() => {
    if (activeTab.scope === 'personal') return PERSONAL_CATEGORIES;
    return draft.type === 'income' ? BRANCH_INCOME_CATEGORIES : BRANCH_EXPENSE_CATEGORIES;
  }, [activeTab.scope, draft.type]);

  // Resetear category cuando cambian tab o type
  useEffect(() => {
    setDraft(d => ({ ...d, category: categoryOptions[0]?.value ?? 'otros' }));
  }, [tab, draft.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const openModal = (preset?: { type?: FinanceType; isQuickAi?: boolean }) => {
    setDraft({
      type: preset?.type ?? 'expense',
      category: activeTab.scope === 'personal' ? 'comida' : (preset?.type === 'income' ? 'ventas' : 'alquiler'),
      amount: '',
      currency: 'ARS',
      description: '',
      movement_date: todayISO(),
    });
    setAiText('');
    setParseError(null);
    setModalOpen(true);
  };

  const handleAiParse = async () => {
    if (!aiText.trim()) return;
    setParsing(true);
    setParseError(null);
    try {
      const res = await parseFinanceText(aiText.trim(), activeTab.scope);
      if (!res.ok) {
        setParseError(res.error ?? 'No pude entender el texto');
        return;
      }
      setDraft({
        type: res.type ?? 'expense',
        category: res.category ?? 'otros',
        amount: String(res.amount ?? ''),
        currency: res.currency ?? 'ARS',
        description: res.description ?? aiText.trim(),
        movement_date: res.movement_date ?? todayISO(),
      });
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async () => {
    if (!draft.amount || Number(draft.amount) <= 0) {
      alert('Falta el monto.');
      return;
    }
    setSaving(true);
    try {
      await createMovement({
        scope: activeTab.scope,
        scope_id: activeTab.scope_id,
        type: draft.type,
        category: draft.category,
        amount_original: Number(draft.amount),
        currency_original: draft.currency,
        description: draft.description || undefined,
        movement_date: draft.movement_date,
      });
      setModalOpen(false);
      await refresh();
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este movimiento?')) return;
    await deleteMovement(id);
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

  const months = yearMonthOptions(12);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Mis Finanzas</h1>
          <p className="text-sm text-gray-500">
            Personal + locales · {blueRate ? (
              <>Blue: <strong>${blueRate.promedio.toFixed(0)}</strong> ARS/USD</>
            ) : 'Cargando blue…'}
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={yearMonth}
            onChange={e => setYearMonth(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm bg-white"
          >
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button
            onClick={() => openModal()}
            className="px-4 py-2 bg-crimson text-white rounded-lg text-sm font-medium hover:opacity-90"
          >
            + Movimiento
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-crimson text-crimson'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Resumen del mes */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 md:p-4">
          <div className="text-xs text-emerald-700 font-medium">Ingresos</div>
          <div className="text-lg md:text-2xl font-bold text-emerald-900 mt-1">
            {formatUSD(totals.income_usd)}
          </div>
          <div className="text-xs text-emerald-600 mt-1">{totals.income_count} mov.</div>
        </div>
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 md:p-4">
          <div className="text-xs text-rose-700 font-medium">Gastos</div>
          <div className="text-lg md:text-2xl font-bold text-rose-900 mt-1">
            {formatUSD(totals.expense_usd)}
          </div>
          <div className="text-xs text-rose-600 mt-1">{totals.expense_count} mov.</div>
        </div>
        <div className={`border rounded-2xl p-3 md:p-4 ${
          totals.balance_usd >= 0
            ? 'bg-blue-50 border-blue-100'
            : 'bg-amber-50 border-amber-100'
        }`}>
          <div className={`text-xs font-medium ${totals.balance_usd >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>
            Balance
          </div>
          <div className={`text-lg md:text-2xl font-bold mt-1 ${
            totals.balance_usd >= 0 ? 'text-blue-900' : 'text-amber-900'
          }`}>
            {formatUSD(totals.balance_usd)}
          </div>
          <div className={`text-xs mt-1 ${totals.balance_usd >= 0 ? 'text-blue-600' : 'text-amber-600'}`}>
            {totals.balance_usd >= 0 ? 'ahorro' : 'déficit'}
          </div>
        </div>
      </div>

      {/* Top categorías */}
      {totals.by_category.length > 0 && (
        <div className="bg-white border rounded-2xl p-4">
          <div className="text-sm font-medium mb-2">Top categorías del mes</div>
          <div className="space-y-1.5">
            {totals.by_category.slice(0, 6).map(c => {
              const total = totals.income_usd + totals.expense_usd;
              const pct = total > 0 ? (c.total_usd / total) * 100 : 0;
              return (
                <div key={c.category} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">
                    {categoryLabel(c.category, activeTab.scope)}
                    <span className="text-gray-400 ml-1">({c.count})</span>
                  </span>
                  <span className="font-medium tabular-nums">{formatUSD(c.total_usd)}
                    <span className="text-gray-400 ml-1">{pct.toFixed(0)}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lista de movimientos */}
      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-medium">Movimientos del mes</h2>
          <span className="text-xs text-gray-500">{movements.length}</span>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">Cargando…</div>
        ) : movements.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            Sin movimientos este mes.
            <br />
            <button
              onClick={() => openModal()}
              className="mt-3 text-crimson font-medium hover:underline"
            >
              Cargá el primero →
            </button>
          </div>
        ) : (
          <div className="divide-y">
            {movements.map(m => (
              <div key={m.id} className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${
                      m.type === 'income' ? 'bg-emerald-500' : 'bg-rose-500'
                    }`} />
                    <span className="text-sm font-medium truncate">
                      {m.description || categoryLabel(m.category, activeTab.scope, m.type)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                    <span>{categoryLabel(m.category, activeTab.scope, m.type)}</span>
                    <span>·</span>
                    <span>{new Date(m.movement_date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-sm font-semibold tabular-nums ${
                    m.type === 'income' ? 'text-emerald-700' : 'text-rose-700'
                  }`}>
                    {m.type === 'income' ? '+' : '-'}{formatUSD(m.amount_usd)}
                  </div>
                  {m.currency_original === 'ARS' && (
                    <div className="text-xs text-gray-400 tabular-nums">
                      {formatARS(m.amount_original)}
                    </div>
                  )}
                  <button
                    onClick={() => handleDelete(m.id)}
                    className="text-xs text-gray-400 hover:text-rose-600 mt-0.5"
                  >
                    eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal carga */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nuevo movimiento">
        <div className="space-y-4">
          {/* IA quick input */}
          <div className="bg-violet-50 border border-violet-100 rounded-xl p-3">
            <label className="text-xs font-medium text-violet-900 flex items-center gap-1">
              <span>✨ Carga rápida con IA</span>
            </label>
            <p className="text-xs text-violet-700 mt-0.5">
              Ej: "salí a comer con Juan $50.000" o "pagué el alquiler 1500 dólares"
            </p>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={aiText}
                onChange={e => setAiText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAiParse()}
                placeholder="Contame qué pasó…"
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
              />
              <button
                onClick={handleAiParse}
                disabled={parsing || !aiText.trim()}
                className="px-3 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
              >
                {parsing ? '…' : 'Parsear'}
              </button>
            </div>
            {parseError && <p className="text-xs text-rose-600 mt-1.5">{parseError}</p>}
          </div>

          {/* Form manual */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-700">Tipo</label>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setDraft(d => ({ ...d, type: 'expense' }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                    draft.type === 'expense'
                      ? 'bg-rose-50 border-rose-300 text-rose-900'
                      : 'border-gray-200 text-gray-600'
                  }`}
                >Gasto</button>
                <button
                  onClick={() => setDraft(d => ({ ...d, type: 'income' }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                    draft.type === 'income'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : 'border-gray-200 text-gray-600'
                  }`}
                  disabled={activeTab.scope === 'personal'}
                  title={activeTab.scope === 'personal' ? 'Ingresos solo en locales' : ''}
                >Ingreso</button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700">Categoría</label>
              <select
                value={draft.category}
                onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
              >
                {categoryOptions.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700">Fecha</label>
              <input
                type="date"
                value={draft.movement_date}
                onChange={e => setDraft(d => ({ ...d, movement_date: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700">Monto</label>
              <input
                type="number"
                value={draft.amount}
                onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700">Moneda</label>
              <select
                value={draft.currency}
                onChange={e => setDraft(d => ({ ...d, currency: e.target.value as Currency }))}
                className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
              >
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-700">Descripción (opcional)</label>
              <input
                type="text"
                value={draft.description}
                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                placeholder="Notas, comercio, persona…"
                className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
              />
            </div>
          </div>

          {/* Preview USD */}
          {draft.amount && Number(draft.amount) > 0 && draft.currency === 'ARS' && blueRate && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2 text-center">
              {formatARS(Number(draft.amount))} ≈ {formatUSD(Number(draft.amount) / blueRate.promedio)}
              {' '}<span className="text-gray-400">(blue ${blueRate.promedio.toFixed(0)})</span>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t">
            <button
              onClick={() => setModalOpen(false)}
              className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50"
            >Cancelar</button>
            <button
              onClick={handleSave}
              disabled={saving || !draft.amount}
              className="flex-1 px-4 py-2 bg-crimson text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
