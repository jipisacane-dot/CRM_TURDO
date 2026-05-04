import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Modal } from '../components/ui/Modal';
import {
  agentsApi,
  advancesApi,
  commissionsApi,
  documentsApi,
  operationsApi,
  currentYearMonth,
  fmtARS,
  fmtUSD,
  fmtDate,
  monthLabel,
  DOC_CATEGORIES,
  type AdvanceWithAgent,
  type CommissionWithRefs,
  type DBAgent,
  type DBDocument,
  type PendingApprovalRow,
} from '../services/commissions';
import { supabase } from '../services/supabase';
import { downloadReceiptPDF } from '../services/pdfReceipts';

interface AgentRow {
  agent: DBAgent;
  commissions: CommissionWithRefs[];
  totalUsd: number;
  totalUsdPaid: number;
  totalUsdPending: number;
}

const yearMonthOptions = (count = 12): string[] => {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
};

export default function Payroll() {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';

  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [exchangeRate, setExchangeRate] = useState<string>('1300');
  const [agents, setAgents] = useState<DBAgent[]>([]);
  const [commissions, setCommissions] = useState<CommissionWithRefs[]>([]);
  const [advances, setAdvances] = useState<AdvanceWithAgent[]>([]);
  const [allAdvances, setAllAdvances] = useState<AdvanceWithAgent[]>([]);
  const [pendingOps, setPendingOps] = useState<PendingApprovalRow[]>([]);
  const [pendingOpsDocsCount, setPendingOpsDocsCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [detailAgent, setDetailAgent] = useState<DBAgent | null>(null);
  const [rejectModal, setRejectModal] = useState<{ op: PendingApprovalRow; reason: string } | null>(null);
  const [docsModal, setDocsModal] = useState<{ op: PendingApprovalRow; docs: DBDocument[] } | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [a, c, advMonth, advAll, pend] = await Promise.all([
        agentsApi.list(),
        commissionsApi.listForMonth(yearMonth),
        advancesApi.listForMonth(yearMonth),
        advancesApi.list(),
        operationsApi.listPendingApproval(),
      ]);
      setAgents(a);
      setCommissions(c);
      setAdvances(advMonth);
      setAllAdvances(advAll);
      setPendingOps(pend);

      // Fetch counts de docs por operation pendiente, una sola query
      if (pend.length > 0) {
        const opIds = pend.map(p => p.id);
        const { data: docs } = await supabase
          .from('operation_documents')
          .select('operation_id')
          .in('operation_id', opIds);
        const counts: Record<string, number> = {};
        for (const d of docs ?? []) counts[d.operation_id] = (counts[d.operation_id] ?? 0) + 1;
        setPendingOpsDocsCount(counts);
      } else {
        setPendingOpsDocsCount({});
      }
    } finally {
      setLoading(false);
    }
  };

  const openDocsModal = async (op: PendingApprovalRow) => {
    try {
      const docs = await documentsApi.listForOperation(op.id);
      setDocsModal({ op, docs });
    } catch (e) {
      alert('Error cargando docs: ' + (e as Error).message);
    }
  };

  const previewDoc = async (doc: DBDocument) => {
    const url = await documentsApi.getPublicUrl(doc.file_path);
    window.open(url, '_blank');
  };

  const approveOp = async (id: string) => {
    if (!confirm('¿Aprobar esta venta? Se generan las comisiones automáticamente.')) return;
    await operationsApi.approve(id, currentUser.id);
    await refresh();
  };

  const rejectOp = async () => {
    if (!rejectModal) return;
    if (!rejectModal.reason.trim()) {
      alert('Tenés que escribir un motivo del rechazo.');
      return;
    }
    await operationsApi.reject(rejectModal.op.id, rejectModal.reason.trim(), currentUser.id);
    setRejectModal(null);
    await refresh();
  };

  useEffect(() => { void refresh(); }, [yearMonth]);

  const rate = Number(exchangeRate) || 0;

  const rows: (AgentRow & { advancesUsd: number; advancesArs: number })[] = useMemo(() => {
    const sellable = agents.filter(a => a.role === 'agent' && a.active);
    return sellable.map(a => {
      const cs = commissions.filter(c => c.agent_id === a.id);
      const totalUsd = cs.reduce((s, c) => s + Number(c.monto_usd), 0);
      const totalUsdPaid = cs.filter(c => c.paid).reduce((s, c) => s + Number(c.monto_usd), 0);
      const totalUsdPending = totalUsd - totalUsdPaid;
      const advancesUsd = advances.filter(adv => adv.agent_id === a.id)
        .reduce((s, adv) => s + Number(adv.amount_usd), 0);
      const advancesArs = advancesUsd * rate;
      return { agent: a, commissions: cs, totalUsd, totalUsdPaid, totalUsdPending, advancesUsd, advancesArs };
    }).sort((x, y) => y.totalUsd - x.totalUsd);
  }, [agents, commissions, advances, rate]);

  const pendingAdvances = useMemo(() => allAdvances.filter(a => a.status === 'pendiente'), [allAdvances]);

  const resolveAdvance = async (id: string, status: 'aprobado' | 'rechazado') => {
    let appliedToMonth: string | undefined;
    if (status === 'aprobado') {
      const month = prompt(
        'Mes al que se aplica el adelanto (YYYY-MM):',
        yearMonth
      );
      if (!month) return;
      appliedToMonth = `${month}-01`;
    }
    const note = status === 'rechazado'
      ? (prompt('Motivo del rechazo (opcional):') ?? undefined)
      : undefined;
    await advancesApi.resolve(id, status, {
      resolvedBy: currentUser.id,
      note,
      appliedToMonth,
      exchangeRate: rate,
    });
    await refresh();
  };

  const grand = useMemo(() => {
    const totalUsd = rows.reduce((s, r) => s + r.totalUsd, 0);
    const totalCommArs = totalUsd * rate;
    const totalAdvancesArs = rows.reduce((s, r) => s + r.advancesArs, 0);
    return {
      totalUsd,
      totalCommArs,
      totalAdvancesArs,
      total: totalCommArs - totalAdvancesArs,
      pendingUsd: rows.reduce((s, r) => s + r.totalUsdPending, 0),
    };
  }, [rows, rate]);

  const markAllPaid = async (agent: DBAgent) => {
    const row = rows.find(r => r.agent.id === agent.id);
    if (!row || row.commissions.length === 0) return;
    const ids = row.commissions.filter(c => !c.paid).map(c => c.id);
    if (ids.length === 0) return;
    if (!confirm(`Marcar ${ids.length} comisión(es) como pagada(s) a ${agent.name}?`)) return;
    await commissionsApi.markPaid(ids, currentUser.id);
    await refresh();
  };

  const toggleCommissionPaid = async (commission: CommissionWithRefs) => {
    if (commission.paid) {
      await commissionsApi.markUnpaid([commission.id]);
    } else {
      await commissionsApi.markPaid([commission.id], currentUser.id);
    }
    await refresh();
  };

  const handleReceipt = (agent: DBAgent) => {
    const cs = commissions.filter(c => c.agent_id === agent.id);
    downloadReceiptPDF({ agent, commissions: cs, yearMonth, exchangeRate: rate });
  };

  const handleAllReceipts = () => {
    rows.forEach(r => {
      downloadReceiptPDF({ agent: r.agent, commissions: r.commissions, yearMonth, exchangeRate: rate });
    });
  };

  if (!isAdmin) {
    return (
      <div className="p-5 md:p-8">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <p className="text-amber-900 font-medium">Esta vista es exclusiva para Leticia (admin).</p>
          <p className="text-amber-700 text-sm mt-1">Si querés ver tus comisiones, andá a "Mis comisiones".</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Liquidación mensual</h1>
        <p className="text-muted text-sm mt-0.5 capitalize">{monthLabel(yearMonth)}</p>
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
        <div>
          <label className="text-xs text-muted mb-1 block">Cotización USD a ARS</label>
          <input
            type="number"
            value={exchangeRate}
            onChange={(e) => setExchangeRate(e.target.value)}
            className="bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A] w-32"
            placeholder="1300"
          />
        </div>
        <button
          onClick={handleAllReceipts}
          className="ml-auto inline-flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-white border border-border text-[#0F172A] hover:bg-bg-hover hover:border-[#0F172A] transition-all font-medium"
          title="Descarga un PDF de recibo por cada vendedor"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" />
          </svg>
          Recibos PDF de todos
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-border rounded-2xl p-5">
          <div className="text-muted text-xs uppercase tracking-wider mb-1">Ventas pendientes</div>
          <div className="text-2xl font-bold text-amber-700">{pendingOps.length}</div>
          <div className="text-xs text-muted mt-0.5">de aprobación</div>
        </div>
        <div className="bg-white border border-border rounded-2xl p-5">
          <div className="text-muted text-xs uppercase tracking-wider mb-1">Comisiones del mes</div>
          <div className="text-2xl font-bold text-[#0F172A]">{fmtUSD(grand.totalUsd)}</div>
          <div className="text-xs text-muted mt-0.5">≈ {fmtARS(grand.totalCommArs)}</div>
        </div>
        <div className="bg-white border border-border rounded-2xl p-5">
          <div className="text-muted text-xs uppercase tracking-wider mb-1">Adelantos del mes</div>
          <div className="text-2xl font-bold text-amber-600">- {fmtARS(grand.totalAdvancesArs)}</div>
        </div>
        <div className="bg-white border border-border rounded-2xl p-5">
          <div className="text-muted text-xs uppercase tracking-wider mb-1">Total a pagar</div>
          <div className="text-2xl font-bold text-crimson">{fmtARS(grand.total)}</div>
        </div>
      </div>

      {/* Operaciones pendientes de aprobación */}
      {pendingOps.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-amber-900 mb-3">
            Ventas pendientes de aprobación ({pendingOps.length})
          </h3>
          <div className="space-y-2">
            {pendingOps.map(op => {
              const turdo = Number(op.precio_venta_usd) * Number(op.agency_commission_pct ?? 6) / 100;
              const pct = op.orden_estimado === 1 ? 20 : op.orden_estimado === 2 ? 25 : 30;
              const agente = turdo * pct / 100;
              const docsCount = pendingOpsDocsCount[op.id] ?? 0;
              return (
                <div key={op.id} className="bg-white border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#0F172A]">
                      {op.vendedor_name ?? '—'} · {op.property_address ?? 'Sin dirección'}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      Boleto {fmtDate(op.fecha_boleto)} · <span className="font-semibold">{fmtUSD(Number(op.precio_venta_usd))}</span>
                      {' '}· sería la <strong>#{op.orden_estimado}</strong> del mes ({pct}%) → comisión <strong>{fmtUSD(agente)}</strong>
                    </div>
                    {op.notes && <div className="text-xs italic text-muted mt-1">"{op.notes}"</div>}
                  </div>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={() => void openDocsModal(op)}
                      className={`text-xs px-3 py-1.5 rounded-md border transition-all ${
                        docsCount > 0
                          ? 'border-sky-300 text-sky-700 hover:bg-sky-50'
                          : 'border-border text-muted hover:bg-bg-hover'
                      }`}
                      title={docsCount === 0 ? 'No hay documentos cargados' : `Ver ${docsCount} documento${docsCount === 1 ? '' : 's'}`}
                    >
                      {docsCount === 0 ? 'Sin docs' : `📎 ${docsCount} doc${docsCount === 1 ? '' : 's'}`}
                    </button>
                    <button
                      onClick={() => void approveOp(op.id)}
                      className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-all font-medium"
                    >
                      Aprobar
                    </button>
                    <button
                      onClick={() => setRejectModal({ op, reason: '' })}
                      className="text-xs px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50 transition-all"
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Adelantos pendientes de aprobación */}
      {pendingAdvances.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-amber-900 mb-3">
            Adelantos pendientes de aprobación ({pendingAdvances.length})
          </h3>
          <div className="space-y-2">
            {pendingAdvances.map(adv => (
              <div key={adv.id} className="bg-white border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-medium text-[#0F172A]">
                    {adv.agent?.name ?? '—'} pidió <span className="font-bold">{fmtUSD(Number(adv.amount_usd))}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {fmtDate(adv.requested_at.slice(0,10))} · {adv.reason ?? 'Sin motivo declarado'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void resolveAdvance(adv.id, 'aprobado')}
                    className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-all"
                  >
                    Aprobar
                  </button>
                  <button
                    onClick={() => void resolveAdvance(adv.id, 'rechazado')}
                    className="text-xs px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50 transition-all"
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla por vendedor */}
      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-hover">
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Vendedor</th>
                <th className="px-4 py-3 font-medium">Sucursal</th>
                <th className="px-4 py-3 font-medium text-center">Operaciones</th>
                <th className="px-4 py-3 font-medium text-right">Comisiones USD</th>
                <th className="px-4 py-3 font-medium text-right">Total ARS</th>
                <th className="px-4 py-3 font-medium text-center">Estado</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted text-sm">Cargando…</td></tr>
              )}
              {!loading && rows.map(r => {
                const totalArs = r.totalUsd * rate - r.advancesArs;
                const allPaid = r.commissions.length > 0 && r.totalUsdPending === 0;
                const pending = r.totalUsdPending > 0;
                return (
                  <tr key={r.agent.id} className="hover:bg-bg-hover transition-colors">
                    <td className="px-4 py-3 text-sm">
                      <button onClick={() => setDetailAgent(r.agent)} className="text-[#0F172A] font-medium hover:text-crimson transition-colors">
                        {r.agent.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">{r.agent.branch ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-center text-[#0F172A]">{r.commissions.length}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">
                      <div className="text-[#0F172A] font-semibold">{fmtUSD(r.totalUsd)}</div>
                      {r.totalUsdPending > 0 && (
                        <div className="text-amber-600 text-xs">Pend: {fmtUSD(r.totalUsdPending)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">
                      <div className="font-bold text-crimson">{fmtARS(totalArs)}</div>
                      {r.advancesArs > 0 && (
                        <div className="text-amber-600 text-[10px]">- {fmtARS(r.advancesArs)} adel.</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-center">
                      {r.commissions.length === 0 ? (
                        <span className="text-muted text-xs">Sin operaciones</span>
                      ) : allPaid ? (
                        <span className="inline-block px-2 py-1 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-md text-xs font-medium">Pagado</span>
                      ) : pending ? (
                        <span className="inline-block px-2 py-1 bg-amber-100 text-amber-700 border border-amber-200 rounded-md text-xs font-medium">Pendiente</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-1.5 justify-end">
                        <button
                          onClick={() => handleReceipt(r.agent)}
                          className="text-xs px-2 py-1.5 rounded-md border border-border text-[#475569] hover:bg-bg-hover transition-all"
                          title="Descargar recibo PDF"
                        >
                          Recibo PDF
                        </button>
                        {r.totalUsdPending > 0 && (
                          <button
                            onClick={() => void markAllPaid(r.agent)}
                            className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-all"
                          >
                            Marcar pagado
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal detalle */}
      <Modal open={!!detailAgent} onClose={() => setDetailAgent(null)} title={detailAgent?.name ?? ''} width="max-w-3xl">
        {detailAgent && (() => {
          const row = rows.find(r => r.agent.id === detailAgent.id);
          if (!row) return null;
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-bg-hover rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-[#0F172A]">{row.commissions.length}</div>
                  <div className="text-xs text-muted">Comisiones</div>
                </div>
                <div className="bg-bg-hover rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-[#0F172A]">{fmtUSD(row.totalUsd)}</div>
                  <div className="text-xs text-muted">Total USD</div>
                </div>
                <div className="bg-bg-hover rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-amber-600">{fmtUSD(row.totalUsdPending)}</div>
                  <div className="text-xs text-muted">Pendiente</div>
                </div>
              </div>

              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-bg-hover">
                    <tr className="text-left text-xs uppercase tracking-wider text-muted">
                      <th className="px-3 py-2 font-medium">Boleto</th>
                      <th className="px-3 py-2 font-medium">Propiedad</th>
                      <th className="px-3 py-2 font-medium">Tipo</th>
                      <th className="px-3 py-2 font-medium text-right">Monto</th>
                      <th className="px-3 py-2 font-medium text-center">Pagado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {row.commissions.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-4 text-center text-muted text-xs">Sin comisiones este mes</td></tr>
                    )}
                    {row.commissions.map(c => (
                      <tr key={c.id}>
                        <td className="px-3 py-2 text-[#0F172A]">{c.operation ? fmtDate(c.operation.fecha_boleto) : '—'}</td>
                        <td className="px-3 py-2 text-[#0F172A]">{c.operation?.property?.address ?? '—'}</td>
                        <td className="px-3 py-2 text-muted capitalize">{c.tipo}</td>
                        <td className="px-3 py-2 text-right text-[#0F172A] font-semibold tabular-nums">{fmtUSD(Number(c.monto_usd))}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => void toggleCommissionPaid(c)}
                            className={`text-xs px-2 py-1 rounded-md border transition-all ${c.paid
                              ? 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200'
                              : 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200'}`}
                          >
                            {c.paid ? 'Pagado' : 'Pendiente'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-bg-hover rounded-xl p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Comisiones (×{rate}):</span>
                  <span className="font-medium text-[#0F172A]">{fmtARS(row.totalUsd * rate)}</span>
                </div>
                {row.advancesArs > 0 && (
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-muted">Adelantos:</span>
                    <span className="font-medium text-amber-700">- {fmtARS(row.advancesArs)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base mt-2 pt-2 border-t border-border">
                  <span className="font-medium text-[#0F172A]">Total a pagar:</span>
                  <span className="font-bold text-crimson">{fmtARS(row.totalUsd * rate - row.advancesArs)}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Modal ver documentos */}
      <Modal open={!!docsModal} onClose={() => setDocsModal(null)} title="Documentos de la venta" width="max-w-2xl">
        {docsModal && (
          <div className="space-y-4">
            <div className="bg-bg-hover rounded-xl p-3 text-sm">
              <div className="font-medium text-[#0F172A]">{docsModal.op.vendedor_name}</div>
              <div className="text-muted text-xs">{docsModal.op.property_address ?? 'Sin dirección'}</div>
              <div className="text-muted text-xs">Boleto {fmtDate(docsModal.op.fecha_boleto)} · {fmtUSD(Number(docsModal.op.precio_venta_usd))}</div>
            </div>
            {docsModal.docs.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 text-center">
                Esta venta todavía no tiene documentos cargados. Si querés, podés aprobarla igual y pedir al vendedor que los suba después.
              </div>
            ) : (
              <div className="space-y-2">
                {docsModal.docs.map(d => {
                  const catLabel = DOC_CATEGORIES.find(c => c.key === d.category)?.label ?? d.category;
                  return (
                    <div key={d.id} className="bg-white border border-border rounded-xl p-3 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs uppercase text-muted tracking-wider">{catLabel}</div>
                        <div className="text-sm text-[#0F172A] font-medium truncate">{d.title}</div>
                        <div className="text-[10px] text-muted">
                          {d.file_name} · {d.file_size ? Math.round(d.file_size / 1024) + ' KB' : ''} · {fmtDate(d.created_at.slice(0, 10))}
                        </div>
                      </div>
                      <button
                        onClick={() => void previewDoc(d)}
                        className="text-xs px-3 py-1.5 rounded-md border border-sky-300 text-sky-700 hover:bg-sky-50 transition-all"
                      >
                        Abrir
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDocsModal(null)}
                className="px-4 py-2 text-sm rounded-xl border border-border text-[#475569] hover:bg-bg-hover transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal rechazar venta */}
      <Modal open={!!rejectModal} onClose={() => setRejectModal(null)} title="Rechazar venta">
        {rejectModal && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
              <div className="font-medium text-[#0F172A]">{rejectModal.op.vendedor_name}</div>
              <div className="text-muted">{rejectModal.op.property_address ?? 'Sin dirección'}</div>
              <div className="text-muted">Boleto {fmtDate(rejectModal.op.fecha_boleto)} · {fmtUSD(Number(rejectModal.op.precio_venta_usd))}</div>
            </div>
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Motivo del rechazo *</label>
              <textarea
                value={rejectModal.reason}
                onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })}
                className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                rows={3}
                placeholder="Ej: precio mal cargado, propiedad no era nuestra, etc."
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRejectModal(null)}
                className="px-4 py-2 text-sm rounded-xl border border-border text-[#475569] hover:bg-bg-hover transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={() => void rejectOp()}
                className="px-4 py-2 text-sm rounded-xl bg-red-600 text-white hover:bg-red-700 transition-all"
              >
                Rechazar venta
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
