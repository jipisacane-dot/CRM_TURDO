import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { appraisalsApi } from '../services/appraisals';
import { Modal } from '../components/ui/Modal';
import PageHeader from '../components/ui/PageHeader';

type Row = Awaited<ReturnType<typeof appraisalsApi.list>>[number];

const STATE_LABEL: Record<string, string> = {
  a_estrenar: 'A estrenar',
  reciclado: 'Reciclado',
  usado_buen_estado: 'Usado',
  usado_regular: 'Usado regular',
};

const fmt = (n: number) => `USD ${n.toLocaleString('es-AR')}`;
const fmtDate = (s: string) => new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

export default function AppraisalList() {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState<string>(''); // email
  const [editing, setEditing] = useState<Row | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const opts = !isAdmin ? { agentEmail: currentUser.email } : undefined;
      const data = await appraisalsApi.list(opts);
      setRows(data);
    } catch (e) {
      setError((e as Error).message ?? 'Error cargando tasaciones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [currentUser.email, isAdmin]);

  const agents = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.agent_email && r.agent_name) map.set(r.agent_email, r.agent_name);
    }
    return Array.from(map.entries()).map(([email, name]) => ({ email, name }));
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (agentFilter) out = out.filter(r => r.agent_email === agentFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(r =>
        r.property_address.toLowerCase().includes(q) ||
        (r.barrio ?? '').toLowerCase().includes(q) ||
        (r.client_name ?? '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, agentFilter, search]);

  // Stats por vendedor (admin only)
  const byAgent = useMemo(() => {
    if (!isAdmin) return [];
    const map = new Map<string, { name: string; email: string; count: number; totalLow: number; totalHigh: number; corrections: number[] }>();
    for (const r of rows) {
      if (!r.agent_email) continue;
      const key = r.agent_email;
      if (!map.has(key)) {
        map.set(key, { name: r.agent_name ?? r.agent_email, email: key, count: 0, totalLow: 0, totalHigh: 0, corrections: [] });
      }
      const e = map.get(key)!;
      e.count += 1;
      e.totalLow += r.suggested_price_low_usd;
      e.totalHigh += r.suggested_price_high_usd;
      if (r.ai_suggested_high_usd && r.suggested_price_high_usd) {
        e.corrections.push((r.suggested_price_high_usd - r.ai_suggested_high_usd) / r.ai_suggested_high_usd);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [rows, isAdmin]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl">
      <PageHeader
        title="Historial de tasaciones"
        subtitle={isAdmin ? 'Todas las tasaciones del equipo. Click para ver detalle y corregir precio.' : 'Tus tasaciones realizadas.'}
        actions={
          <Link
            to="/tasar"
            className="bg-crimson hover:bg-crimson-light text-white px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors"
          >
            ✨ Nueva tasación
          </Link>
        }
      />

      {/* Stats por vendedor — solo admin */}
      {isAdmin && byAgent.length > 0 && (
        <div className="bg-white border border-border rounded-2xl p-4 md:p-5">
          <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">Resumen por vendedor</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {byAgent.map(a => {
              const avgCorr = a.corrections.length > 0
                ? (a.corrections.reduce((s, x) => s + x, 0) / a.corrections.length) * 100
                : null;
              const isActive = agentFilter === a.email;
              return (
                <button
                  key={a.email}
                  onClick={() => setAgentFilter(isActive ? '' : a.email)}
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    isActive
                      ? 'bg-crimson border-crimson text-white'
                      : 'bg-bg-soft border-border hover:border-crimson'
                  }`}
                >
                  <div className={`text-sm font-semibold truncate ${isActive ? 'text-white' : 'text-[#0F172A]'}`}>{a.name}</div>
                  <div className={`text-xs ${isActive ? 'text-white/80' : 'text-muted'}`}>
                    {a.count} {a.count === 1 ? 'tasación' : 'tasaciones'}
                  </div>
                  {avgCorr !== null && (
                    <div className={`text-[10px] mt-1 ${isActive ? 'text-white/70' : 'text-muted'}`}>
                      Ajuste prom: {avgCorr >= 0 ? '+' : ''}{avgCorr.toFixed(1)}%
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por dirección, barrio o cliente…"
          className="flex-1 px-3 py-2.5 border border-border rounded-xl text-sm bg-white outline-none focus:border-crimson"
        />
        {isAdmin && agents.length > 0 && (
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="px-3 py-2.5 border border-border rounded-xl text-sm bg-white outline-none focus:border-crimson md:w-64"
          >
            <option value="">Todos los vendedores</option>
            {agents.map(a => <option key={a.email} value={a.email}>{a.name}</option>)}
          </select>
        )}
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="bg-white border border-border rounded-2xl p-12 text-center">
          <div className="inline-block w-10 h-10 border-3 border-crimson border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-border rounded-2xl p-12 text-center">
          <div className="text-4xl mb-2">📭</div>
          <p className="text-sm text-muted">
            {search || agentFilter ? 'No hay tasaciones con esos filtros.' : 'Todavía no hay tasaciones.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-soft border-b border-border text-xs uppercase text-muted">
                  <th className="text-left px-4 py-3 font-medium">Fecha</th>
                  {isAdmin && <th className="text-left px-4 py-3 font-medium">Vendedor</th>}
                  <th className="text-left px-4 py-3 font-medium">Dirección</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Barrio</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">m²/Amb</th>
                  <th className="text-right px-4 py-3 font-medium">Precio</th>
                  <th className="text-center px-4 py-3 font-medium hidden md:table-cell">Ajuste</th>
                  <th className="text-center px-4 py-3 font-medium">Vistas</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(r => {
                  const corrPct = r.ai_suggested_high_usd && r.ai_suggested_high_usd > 0
                    ? ((r.suggested_price_high_usd - r.ai_suggested_high_usd) / r.ai_suggested_high_usd) * 100
                    : null;
                  return (
                    <tr key={r.id} className="hover:bg-bg-soft/50 cursor-pointer" onClick={() => setEditing(r)}>
                      <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{fmtDate(r.created_at)}</td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-xs">
                          <span className="bg-crimson/10 text-crimson px-2 py-0.5 rounded-full whitespace-nowrap">
                            {r.agent_name ?? r.agent_email ?? '?'}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3 text-[#0F172A] font-medium truncate max-w-[180px]">{r.property_address}</td>
                      <td className="px-4 py-3 text-muted text-xs hidden md:table-cell">{r.barrio ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-xs text-muted whitespace-nowrap hidden md:table-cell">
                        {r.surface_m2 ? `${r.surface_m2}m²` : '—'} · {r.rooms ?? '?'}amb
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#0F172A] whitespace-nowrap">
                        {fmt(r.suggested_price_low_usd)} — {fmt(r.suggested_price_high_usd)}
                      </td>
                      <td className="px-4 py-3 text-center text-xs hidden md:table-cell">
                        {corrPct !== null ? (
                          <span className={`tabular-nums ${corrPct > 0 ? 'text-emerald-600' : corrPct < 0 ? 'text-amber-600' : 'text-muted'}`}>
                            {corrPct >= 0 ? '+' : ''}{corrPct.toFixed(1)}%
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-muted">{r.view_count ?? 0}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-crimson text-xs">Editar →</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 text-xs text-muted bg-bg-soft border-t border-border">
            {filtered.length} tasaci{filtered.length === 1 ? 'ón' : 'ones'}
          </div>
        </div>
      )}

      <EditModal row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
    </div>
  );
}

function EditModal({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const [low, setLow] = useState<number>(0);
  const [high, setHigh] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (row) {
      setLow(row.suggested_price_low_usd);
      setHigh(row.suggested_price_high_usd);
      setError(null);
    }
  }, [row?.id]);

  if (!row) return null;

  const aiLow = row.ai_suggested_low_usd;
  const aiHigh = row.ai_suggested_high_usd;
  const publicUrl = `${window.location.origin}/t/${row.share_token}`;

  const save = async () => {
    if (low >= high) { setError('El mínimo debe ser menor que el máximo.'); return; }
    setSaving(true);
    setError(null);
    try {
      await appraisalsApi.update({
        appraisal_id: row.id,
        suggested_price_low_usd: low,
        suggested_price_high_usd: high,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message ?? 'Error guardando');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!row} onClose={onClose} title="Editar tasación" width="max-w-lg">
      <div className="space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Propiedad</div>
          <div className="font-semibold text-[#0F172A]">{row.property_address}</div>
          <div className="text-sm text-muted mt-0.5">
            {[row.barrio, row.surface_m2 ? `${row.surface_m2}m²` : null, row.rooms ? `${row.rooms} amb` : null, row.property_state ? STATE_LABEL[row.property_state] : null].filter(Boolean).join(' · ')}
          </div>
          {row.client_name && <div className="text-xs text-muted mt-1">Cliente: {row.client_name}</div>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted block mb-1">Mínimo (cierre)</label>
            <div className="flex items-center gap-1.5 border border-border rounded-xl px-3 py-2 bg-white">
              <span className="text-xs text-muted">USD</span>
              <input
                type="number"
                value={low || ''}
                onChange={e => setLow(Number(e.target.value) || 0)}
                className="bg-transparent text-base font-semibold tabular-nums outline-none w-full text-[#0F172A]"
              />
            </div>
            {aiLow != null && aiLow !== low && (
              <div className="text-[10px] text-muted mt-1">IA: USD {aiLow.toLocaleString('es-AR')}</div>
            )}
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Máximo (publicación)</label>
            <div className="flex items-center gap-1.5 border border-border rounded-xl px-3 py-2 bg-white">
              <span className="text-xs text-muted">USD</span>
              <input
                type="number"
                value={high || ''}
                onChange={e => setHigh(Number(e.target.value) || 0)}
                className="bg-transparent text-base font-semibold tabular-nums outline-none w-full text-[#0F172A]"
              />
            </div>
            {aiHigh != null && aiHigh !== high && (
              <div className="text-[10px] text-muted mt-1">IA: USD {aiHigh.toLocaleString('es-AR')}</div>
            )}
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <div className="text-xs font-semibold text-emerald-900 mb-1">🔗 Link público</div>
          <div className="bg-white border border-emerald-200 rounded-lg p-1.5 mb-2">
            <code className="text-[11px] text-[#0F172A] break-all">{publicUrl}</code>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={async () => { await navigator.clipboard.writeText(publicUrl); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); }}
              className="bg-white border border-border text-[#0F172A] py-1.5 rounded-lg text-xs font-medium"
            >
              {linkCopied ? '✓ Copiado' : '📋 Copiar'}
            </button>
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="bg-white border border-border text-[#0F172A] py-1.5 rounded-lg text-xs font-medium text-center"
            >
              👁 Vista cliente
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button onClick={onClose} className="bg-white border border-border text-[#0F172A] py-2.5 rounded-xl text-sm font-medium hover:bg-bg-soft">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || low <= 0 || high <= 0 || low >= high}
            className="bg-crimson hover:bg-crimson-light text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
