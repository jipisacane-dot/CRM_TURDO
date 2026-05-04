import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Modal } from '../components/ui/Modal';
import {
  agentsApi,
  advancesApi,
  commissionsApi,
  operationsApi,
  fmtARS,
  fmtUSD,
  fmtDate,
  monthLabel,
  currentYearMonth,
  escalonadoPctForOrden,
  type AdvanceWithAgent,
  type CommissionWithRefs,
  type DBAgent,
  type OperationWithRefs,
} from '../services/commissions';
import { downloadReceiptPDF } from '../services/pdfReceipts';

export default function MyCommissions() {
  const { currentUser } = useApp();

  const [agentDb, setAgentDb] = useState<DBAgent | null>(null);
  const [allCommissions, setAllCommissions] = useState<CommissionWithRefs[]>([]);
  const [myOperations, setMyOperations] = useState<OperationWithRefs[]>([]);
  const [advances, setAdvances] = useState<AdvanceWithAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [exchangeRate, setExchangeRate] = useState<string>('1300');
  const [advanceModal, setAdvanceModal] = useState(false);
  const [advAmount, setAdvAmount] = useState('');
  const [advReason, setAdvReason] = useState('');
  const [advSaving, setAdvSaving] = useState(false);

  const reload = async (agentId: string) => {
    const [cs, ads, ops] = await Promise.all([
      commissionsApi.listForAgent(agentId),
      advancesApi.listForAgent(agentId),
      operationsApi.listWithRefs(),
    ]);
    setAllCommissions(cs);
    setAdvances(ads);
    setMyOperations(ops.filter(o => o.vendedor_id === agentId));
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const agents = await agentsApi.list();
        const me = agents.find(a => a.email === currentUser.email);
        setAgentDb(me ?? null);
        if (me) await reload(me.id);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [currentUser.email]);

  const requestAdvance = async () => {
    if (!agentDb) return;
    const amount = Number(advAmount);
    if (!amount || amount <= 0) {
      alert('Ingresá un monto válido en USD.');
      return;
    }
    setAdvSaving(true);
    try {
      await advancesApi.create({ agent_id: agentDb.id, amount_usd: amount, reason: advReason || undefined });
      setAdvAmount('');
      setAdvReason('');
      setAdvanceModal(false);
      await reload(agentDb.id);
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setAdvSaving(false);
    }
  };

  const rate = Number(exchangeRate) || 0;
  const ym = currentYearMonth();

  const byMonth = useMemo(() => {
    const map = new Map<string, CommissionWithRefs[]>();
    for (const c of allCommissions) {
      const m = c.mes_liquidacion.slice(0, 7);
      const arr = map.get(m) ?? [];
      arr.push(c);
      map.set(m, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [allCommissions]);

  const thisMonth = useMemo(() => {
    return allCommissions.filter(c => c.mes_liquidacion.startsWith(ym));
  }, [allCommissions, ym]);

  const thisMonthTotalUsd = thisMonth.reduce((s, c) => s + Number(c.monto_usd), 0);
  const thisMonthTotalArs = thisMonthTotalUsd * rate;

  const advancesThisMonth = advances.filter(a =>
    a.applied_to_month?.startsWith(ym) && (a.status === 'aprobado' || a.status === 'liquidado')
  );
  const advancesTotalUsd = advancesThisMonth.reduce((s, a) => s + Number(a.amount_usd), 0);
  const advancesTotalArs = advancesTotalUsd * rate;

  const thisMonthGrandTotal = thisMonthTotalArs - advancesTotalArs;

  const pendingAdvances = advances.filter(a => a.status === 'pendiente');

  // Ventas pendientes / rechazadas del mes (sin commission generada todavía)
  const myMonthOps = useMemo(() =>
    myOperations.filter(o => o.fecha_boleto?.startsWith(ym)),
    [myOperations, ym],
  );
  const pendingOps = myMonthOps.filter(o => o.approval_status === 'pending');
  const rejectedOps = myMonthOps.filter(o => o.approval_status === 'rejected');
  const approvedOpsCount = myMonthOps.filter(o => o.approval_status === 'approved').length;
  // Para el preview: si cargo otra venta ahora, sería la #(approvedOpsCount + pending + 1)
  const nextOrden = approvedOpsCount + pendingOps.length + 1;
  const nextPct = escalonadoPctForOrden(nextOrden);

  if (loading) {
    return <div className="p-5 md:p-8 text-muted text-sm">Cargando…</div>;
  }

  if (!agentDb) {
    return (
      <div className="p-5 md:p-8">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <p className="text-amber-900 font-medium">No encontramos tu perfil de vendedor.</p>
          <p className="text-amber-700 text-sm mt-1">Contactá al admin para que te dé de alta en la base.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Mis comisiones</h1>
        <p className="text-muted text-sm mt-0.5">{agentDb.name} · {agentDb.branch ?? 'Sin sucursal'}</p>
      </div>

      {/* Cotización + adelanto */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted mb-1 block">Cotización USD a ARS (referencia)</label>
          <input
            type="number"
            value={exchangeRate}
            onChange={(e) => setExchangeRate(e.target.value)}
            className="bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A] w-32"
            placeholder="1300"
          />
        </div>
        <button
          onClick={() => setAdvanceModal(true)}
          className="ml-auto px-4 py-2 text-sm rounded-xl border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 transition-all"
        >
          Pedir adelanto de comisión
        </button>
      </div>

      {/* Adelantos pendientes */}
      {pendingAdvances.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="text-sm font-semibold text-amber-900 mb-2">Tus adelantos pendientes de aprobación</div>
          <div className="space-y-1">
            {pendingAdvances.map(a => (
              <div key={a.id} className="text-sm text-amber-800 flex justify-between">
                <span>{fmtDate(a.requested_at.slice(0,10))} — {a.reason ?? 'Sin motivo'}</span>
                <span className="font-semibold">{fmtUSD(Number(a.amount_usd))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header del mes en curso */}
      <div className="bg-gradient-to-br from-crimson to-crimson-bright text-white rounded-2xl p-6">
        <div className="text-xs uppercase tracking-wider opacity-80 mb-1 capitalize">Liquidación {monthLabel(ym)}</div>
        <div className="flex items-baseline gap-4 flex-wrap">
          <div>
            <div className="text-3xl font-bold tabular-nums">{fmtARS(thisMonthGrandTotal)}</div>
            <div className="text-sm opacity-80 mt-0.5">Total a cobrar este mes</div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-white/20">
          <div>
            <div className="text-xs uppercase opacity-80">Ventas aprobadas</div>
            <div className="text-lg font-semibold mt-0.5 tabular-nums">{approvedOpsCount}</div>
          </div>
          <div>
            <div className="text-xs uppercase opacity-80">Comisiones USD</div>
            <div className="text-lg font-semibold mt-0.5 tabular-nums">{fmtUSD(thisMonthTotalUsd)}</div>
          </div>
          <div>
            <div className="text-xs uppercase opacity-80">Comisiones ARS</div>
            <div className="text-lg font-semibold mt-0.5 tabular-nums">{fmtARS(thisMonthTotalArs)}</div>
          </div>
          {advancesTotalUsd > 0 && (
            <div>
              <div className="text-xs uppercase opacity-80">Adelantos cobrados</div>
              <div className="text-lg font-semibold mt-0.5 tabular-nums">- {fmtARS(advancesTotalArs)}</div>
            </div>
          )}
        </div>
        <div className="mt-4 pt-4 border-t border-white/20 text-xs opacity-90">
          Si cargás otra venta ahora, sería la <strong>#{nextOrden}</strong> del mes → <strong>{nextPct}%</strong> sobre el 6% de Turdo.
        </div>
      </div>

      {/* Ventas pendientes de aprobación o rechazadas */}
      {(pendingOps.length > 0 || rejectedOps.length > 0) && (
        <div className="space-y-3">
          {pendingOps.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="text-sm font-semibold text-amber-900 mb-2">
                Tenés {pendingOps.length} venta{pendingOps.length === 1 ? '' : 's'} pendiente{pendingOps.length === 1 ? '' : 's'} de aprobación de Leticia
              </div>
              <div className="space-y-1">
                {pendingOps.map(o => (
                  <div key={o.id} className="text-sm text-amber-800 flex justify-between">
                    <span>{fmtDate(o.fecha_boleto)} — {o.property?.address ?? 'sin dirección'}</span>
                    <span className="font-semibold">{fmtUSD(Number(o.precio_venta_usd))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {rejectedOps.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <div className="text-sm font-semibold text-red-900 mb-2">
                Ventas rechazadas este mes ({rejectedOps.length})
              </div>
              <div className="space-y-1">
                {rejectedOps.map(o => (
                  <div key={o.id} className="text-sm text-red-800">
                    <div className="flex justify-between">
                      <span>{fmtDate(o.fecha_boleto)} — {o.property?.address ?? 'sin dirección'}</span>
                      <span>{fmtUSD(Number(o.precio_venta_usd))}</span>
                    </div>
                    {o.rejected_reason && <div className="text-xs italic mt-0.5">Motivo: {o.rejected_reason}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Histórico mes a mes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-[#0F172A]">Histórico</h2>
          {thisMonth.length > 0 && (
            <button
              onClick={() => downloadReceiptPDF({ agent: agentDb, commissions: thisMonth, yearMonth: ym, exchangeRate: rate })}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-[#475569] hover:bg-bg-hover transition-all"
            >
              Descargar recibo del mes
            </button>
          )}
        </div>

        {byMonth.length === 0 && (
          <div className="bg-white border border-border rounded-2xl p-8 text-center text-muted text-sm">
            Todavía no tenés comisiones cargadas. Cuando se cargue tu primera venta, aparece acá.
          </div>
        )}

        <div className="space-y-3">
          {byMonth.map(([month, list]) => {
            const totalUsd = list.reduce((s, c) => s + Number(c.monto_usd), 0);
            const paidUsd = list.filter(c => c.paid).reduce((s, c) => s + Number(c.monto_usd), 0);
            const pendingUsd = totalUsd - paidUsd;
            return (
              <div key={month} className="bg-white border border-border rounded-2xl overflow-hidden">
                <div className="bg-bg-hover px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                  <div className="text-sm font-semibold text-[#0F172A] capitalize">{monthLabel(month)}</div>
                  <div className="flex gap-3 text-sm">
                    <div className="text-[#0F172A]"><span className="text-muted">Total:</span> <span className="font-semibold tabular-nums">{fmtUSD(totalUsd)}</span></div>
                    {pendingUsd > 0 && (
                      <div className="text-amber-600"><span className="text-muted">Pend:</span> <span className="font-semibold tabular-nums">{fmtUSD(pendingUsd)}</span></div>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border">
                      <tr className="text-left text-xs uppercase tracking-wider text-muted">
                        <th className="px-4 py-2 font-medium">Boleto</th>
                        <th className="px-4 py-2 font-medium">Propiedad</th>
                        <th className="px-4 py-2 font-medium text-center">N°</th>
                        <th className="px-4 py-2 font-medium text-right">Precio venta</th>
                        <th className="px-4 py-2 font-medium text-right">% escal.</th>
                        <th className="px-4 py-2 font-medium text-right">Mi comisión</th>
                        <th className="px-4 py-2 font-medium text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {list.map(c => {
                        const orden = c.nivel_escalonado ?? '—';
                        return (
                          <tr key={c.id}>
                            <td className="px-4 py-2 text-[#0F172A]">{c.operation ? fmtDate(c.operation.fecha_boleto) : '—'}</td>
                            <td className="px-4 py-2 text-[#0F172A]">{c.operation?.property?.address ?? '—'}</td>
                            <td className="px-4 py-2 text-center text-[#0F172A] font-medium tabular-nums">#{orden}</td>
                            <td className="px-4 py-2 text-right text-muted tabular-nums">{c.operation ? fmtUSD(Number(c.operation.precio_venta_usd)) : '—'}</td>
                            <td className="px-4 py-2 text-right text-muted tabular-nums">{Number(c.porcentaje).toFixed(0)}%</td>
                            <td className="px-4 py-2 text-right text-[#0F172A] font-semibold tabular-nums">{fmtUSD(Number(c.monto_usd))}</td>
                            <td className="px-4 py-2 text-center">
                              {c.paid ? (
                                <span className="inline-block px-2 py-1 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-md text-xs font-medium">Pagado</span>
                              ) : (
                                <span className="inline-block px-2 py-1 bg-amber-100 text-amber-700 border border-amber-200 rounded-md text-xs font-medium">Por cobrar</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal pedir adelanto */}
      <Modal open={advanceModal} onClose={() => setAdvanceModal(false)} title="Pedir adelanto de comisión">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            El adelanto pasa a aprobación de Leticia. Si lo aprueba, se descuenta del próximo pago de comisiones.
          </p>
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Monto USD</label>
            <input
              type="number"
              value={advAmount}
              onChange={(e) => setAdvAmount(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              placeholder="500"
              autoFocus
            />
            {advAmount && Number(advAmount) > 0 && (
              <div className="text-xs text-muted mt-1">≈ {fmtARS(Number(advAmount) * rate)} a la cotización actual</div>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Motivo (opcional)</label>
            <textarea
              value={advReason}
              onChange={(e) => setAdvReason(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              rows={3}
              placeholder="Ej: Necesito adelantar un gasto familiar"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setAdvanceModal(false)}
              disabled={advSaving}
              className="px-4 py-2 text-sm rounded-xl border border-border text-[#475569] hover:bg-bg-hover transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={() => void requestAdvance()}
              disabled={advSaving}
              className="px-4 py-2 text-sm rounded-xl bg-crimson text-white hover:bg-crimson-bright transition-all disabled:opacity-60"
            >
              {advSaving ? 'Enviando…' : 'Enviar pedido'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
