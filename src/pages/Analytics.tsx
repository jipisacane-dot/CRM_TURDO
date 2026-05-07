import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { useApp } from '../contexts/AppContext';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend, LineChart, Line, CartesianGrid,
} from 'recharts';
import {
  agentsApi,
  fmtUSD,
  type DBAgent,
} from '../services/commissions';
import {
  analyticsApi,
  REASON_LABEL,
  KIND_LABEL,
  type FunnelByAgent,
  type ResponseTimeStats,
  type ConversionByChannel,
  type ForecastSummary,
  type CaidaReason,
  type SaleCycleStats,
  type MonthlySummaryRow,
} from '../services/analytics';
import { downloadAnalyticsReport } from '../services/analyticsPdf';

const COLORS = ['#8B1F1F', '#E07B7B', '#0EA5E9', '#10B981', '#F59E0B', '#A855F7', '#EC4899', '#64748B'];

const channelLabel = (c: string): string => {
  const map: Record<string, string> = {
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    facebook: 'Facebook',
    web: 'Sitio web',
    zonaprop: 'ZonaProp',
    argenprop: 'ArgenProp',
    mercadolibre: 'MercadoLibre',
    email: 'Email',
  };
  return map[c] ?? c;
};

const fmtMinutes = (m: number | null): string => {
  if (m == null) return '—';
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} hs`;
  return `${(m / 1440).toFixed(1)} d`;
};

export default function Analytics() {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [agents, setAgents] = useState<DBAgent[]>([]);
  const [funnel, setFunnel] = useState<FunnelByAgent[]>([]);
  const [responseTime, setResponseTime] = useState<ResponseTimeStats | null>(null);
  const [conversion, setConversion] = useState<ConversionByChannel[]>([]);
  const [forecast, setForecast] = useState<ForecastSummary | null>(null);
  const [caidas, setCaidas] = useState<CaidaReason[]>([]);
  const [saleCycle, setSaleCycle] = useState<SaleCycleStats | null>(null);
  const [monthly, setMonthly] = useState<MonthlySummaryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [a, f, rt, conv, fc, c, sc, ms] = await Promise.all([
          agentsApi.list(),
          analyticsApi.funnel(),
          analyticsApi.responseTime(),
          analyticsApi.conversionByChannel(),
          analyticsApi.forecast(),
          analyticsApi.caidas(),
          analyticsApi.saleCycle(),
          analyticsApi.monthlySummary(6),
        ]);
        setAgents(a);
        setFunnel(f);
        setResponseTime(rt);
        setConversion(conv);
        setForecast(fc);
        setCaidas(c);
        setSaleCycle(sc);
        setMonthly(ms);
      } catch (e) {
        console.error(e);
        setError('Error cargando analíticas: ' + (e as Error).message);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  // Resolver agent_key a name (puede ser uuid o string mock o '_unassigned')
  const agentName = (key: string): string => {
    if (key === '_unassigned' || key === '_sin_asignar') return 'Sin asignar';
    const byId = agents.find(a => a.id === key);
    if (byId) return byId.name;
    return key;
  };

  // Datos para charts
  const funnelChartData = useMemo(() => funnel
    .filter(f => f.leads_total > 0 || f.ventas_aprobadas > 0)
    .map(f => ({
      name: agentName(f.agent_key),
      Leads: f.leads_total,
      Contactados: f.leads_contactados,
      'En negociación': f.negociaciones_activas,
      Ventas: f.ventas_aprobadas,
    }))
    .sort((a, b) => b.Leads - a.Leads), [funnel, agents]);

  const channelChartData = useMemo(() => conversion.map(c => ({
    name: channelLabel(c.channel),
    Leads: c.total_leads,
    Contactados: c.leads_contactados,
    Ventas: c.ventas_cerradas,
    '% Conversión': c.tasa_conversion_pct,
  })), [conversion]);

  const caidasChartData = useMemo(() => caidas.map(c => ({
    name: REASON_LABEL[c.reason] ?? c.reason,
    value: c.total,
    avg_days: c.avg_days_to_caida,
  })), [caidas]);

  const monthlyChartData = useMemo(() => {
    // group by month
    type MonthBucket = { mes: string; leads_in: number; messages_out: number; ventas_cerradas: number; negociaciones_inicio: number; negociaciones_caida: number };
    const byMonth = new Map<string, MonthBucket>();
    for (const r of monthly) {
      const key = r.mes.slice(0, 7);
      const cur: MonthBucket = byMonth.get(key) ?? { mes: key, leads_in: 0, messages_out: 0, ventas_cerradas: 0, negociaciones_inicio: 0, negociaciones_caida: 0 };
      const kindKey = r.kind as keyof Omit<MonthBucket, 'mes'>;
      cur[kindKey] = Number(r.total_count);
      byMonth.set(key, cur);
    }
    return Array.from(byMonth.values())
      .map(v => ({
        mes: v.mes,
        Leads: v.leads_in,
        Mensajes: v.messages_out,
        Ventas: v.ventas_cerradas,
        Negociaciones: v.negociaciones_inicio,
      }))
      .sort((a, b) => a.mes.localeCompare(b.mes));
  }, [monthly]);

  const downloadPdf = async () => {
    if (!responseTime || !forecast || !saleCycle) return;
    setDownloading(true);
    try {
      await downloadAnalyticsReport({
        funnel,
        responseTime,
        conversion,
        forecast,
        caidas,
        saleCycle,
        monthly,
        agentName,
      });
    } catch (e) {
      alert('Error generando PDF: ' + (e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-5 md:p-8">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <p className="text-amber-900 font-medium">Las analíticas son exclusivas para Leticia (admin).</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="p-5 md:p-8 text-muted text-sm">Cargando analíticas…</div>;
  }

  if (error) {
    return (
      <div className="p-5 md:p-8">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm">{error}</div>
      </div>
    );
  }

  if (!responseTime || !forecast || !saleCycle) return null;

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Analíticas</h1>
          <p className="text-muted text-sm mt-0.5">Performance del equipo y del negocio</p>
        </div>
        <button
          onClick={() => void downloadPdf()}
          disabled={downloading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-white border border-border text-[#0F172A] hover:bg-bg-hover transition-all font-medium disabled:opacity-60"
        >
          {downloading ? 'Generando…' : '↓ Descargar reporte PDF'}
        </button>
      </div>

      {/* === 1. STATS PRINCIPALES === */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Tasa de respuesta"
          value={`${responseTime.tasa_respuesta_pct}%`}
          sub={`${responseTime.respondidos} de ${responseTime.total_leads} leads`}
          tone={responseTime.tasa_respuesta_pct >= 70 ? 'good' : responseTime.tasa_respuesta_pct >= 40 ? 'warn' : 'bad'}
        />
        <StatCard
          label="Tiempo de 1ra respuesta"
          value={fmtMinutes(responseTime.median_response_min)}
          sub={`promedio ${fmtMinutes(responseTime.avg_response_min)}`}
          tone={(responseTime.median_response_min ?? 999) <= 30 ? 'good' : (responseTime.median_response_min ?? 999) <= 120 ? 'warn' : 'bad'}
        />
        <StatCard
          label="Forecast del mes"
          value={fmtUSD(forecast.total_estimado_usd)}
          sub={`${forecast.ops_pendientes_count} pendientes · ${forecast.negotiations_activas_count} en negoc.`}
          tone="neutral"
        />
        <StatCard
          label="Ciclo de venta"
          value={saleCycle.avg_days != null ? `${saleCycle.avg_days} días` : '—'}
          sub={`mediana ${saleCycle.median_days ?? '—'} días · ${saleCycle.total} ventas`}
          tone="neutral"
        />
      </div>

      {/* === 2. EMBUDO DE CONVERSIÓN === */}
      <Section title="Embudo de conversión por vendedor"
               subtitle="Leads recibidos → contactados → en negociación → vendidos">
        {funnelChartData.length === 0 ? (
          <Empty msg="Sin datos del embudo todavía. A medida que entren leads y se asignen, va a poblarse acá." />
        ) : (
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={funnelChartData} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Leads" fill="#94A3B8" />
                <Bar dataKey="Contactados" fill="#0EA5E9" />
                <Bar dataKey="En negociación" fill="#F59E0B" />
                <Bar dataKey="Ventas" fill="#10B981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* === 3. PERFORMANCE POR VENDEDOR (tabla) === */}
      <Section title="Performance del equipo">
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                <th className="px-3 py-2 font-medium">Vendedor</th>
                <th className="px-3 py-2 font-medium text-right">Leads</th>
                <th className="px-3 py-2 font-medium text-right">Contactados</th>
                <th className="px-3 py-2 font-medium text-right">% Resp.</th>
                <th className="px-3 py-2 font-medium text-right">Negoc.</th>
                <th className="px-3 py-2 font-medium text-right">Ventas</th>
                <th className="px-3 py-2 font-medium text-right">% Conv.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {funnel
                .filter(f => f.leads_total > 0 || f.ventas_aprobadas > 0)
                .sort((a, b) => b.leads_total - a.leads_total)
                .map(f => {
                  const pctResp = f.leads_total > 0 ? Math.round((f.leads_contactados / f.leads_total) * 100) : 0;
                  const pctConv = f.leads_total > 0 ? Math.round((f.ventas_aprobadas / f.leads_total) * 100) : 0;
                  return (
                    <tr key={f.agent_key} className="hover:bg-bg-hover transition-colors">
                      <td className="px-3 py-2 text-[#0F172A] font-medium">{agentName(f.agent_key)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.leads_total}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.leads_contactados}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${pctResp >= 70 ? 'text-emerald-700' : pctResp >= 30 ? 'text-amber-700' : 'text-red-600'}`}>
                        {pctResp}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.negociaciones_activas}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{f.ventas_aprobadas}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${pctConv >= 5 ? 'text-emerald-700' : pctConv >= 1 ? 'text-amber-700' : 'text-muted'}`}>
                        {pctConv}%
                      </td>
                    </tr>
                  );
                })}
              {funnel.filter(f => f.leads_total > 0 || f.ventas_aprobadas > 0).length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted text-xs">Sin datos del equipo todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* === 4. CONVERSIÓN POR CANAL === */}
      <Section title="Conversión por canal" subtitle="De qué canal vienen los leads y cuál convierte mejor">
        {channelChartData.length === 0 ? (
          <Empty msg="No hay leads cargados todavía." />
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={channelChartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Leads" fill="#94A3B8" />
                  <Bar dataKey="Contactados" fill="#0EA5E9" />
                  <Bar dataKey="Ventas" fill="#10B981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                    <th className="px-3 py-2 font-medium">Canal</th>
                    <th className="px-3 py-2 font-medium text-right">Leads</th>
                    <th className="px-3 py-2 font-medium text-right">Ventas</th>
                    <th className="px-3 py-2 font-medium text-right">% Conv.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {conversion.map(c => (
                    <tr key={c.channel}>
                      <td className="px-3 py-2 text-[#0F172A]">{channelLabel(c.channel)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.total_leads}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.ventas_cerradas}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{c.tasa_conversion_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* === 5. FORECAST === */}
      <Section title="Forecast de comisiones (Turdo)" subtitle="Estimado del mes en curso">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ForecastCard
            label="Confirmadas (aprobadas, sin cobrar)"
            value={forecast.comisiones_confirmadas_usd}
            tone="good"
          />
          <ForecastCard
            label="Probables (ventas pendientes)"
            value={forecast.forecast_pending_usd}
            sub={`${forecast.ops_pendientes_count} ventas · estimado al 25%`}
            tone="warn"
          />
          <ForecastCard
            label="Posibles (en negociación)"
            value={forecast.forecast_negotiations_usd}
            sub={`${forecast.negotiations_activas_count} activas · prob. 30%`}
            tone="neutral"
          />
        </div>
        <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-baseline justify-between">
          <span className="text-sm text-emerald-900 font-medium">Total estimado del mes</span>
          <span className="text-2xl font-bold text-emerald-700 tabular-nums">{fmtUSD(forecast.total_estimado_usd)}</span>
        </div>
      </Section>

      {/* === 6. NEGOCIACIONES CAÍDAS === */}
      <Section title="Negociaciones caídas" subtitle="¿Por qué se pierden las negociaciones?">
        {caidasChartData.length === 0 ? (
          <Empty msg="No hay negociaciones caídas registradas todavía. Cuando los vendedores cierren negociaciones con motivo, aparecen acá." />
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={caidasChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: { name?: string; value?: number }) => `${e.name ?? ''}: ${e.value ?? 0}`}>
                    {caidasChartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                    <th className="px-3 py-2 font-medium">Motivo</th>
                    <th className="px-3 py-2 font-medium text-right">Cantidad</th>
                    <th className="px-3 py-2 font-medium text-right">Días promedio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {caidas.map(c => (
                    <tr key={c.reason}>
                      <td className="px-3 py-2 text-[#0F172A]">{REASON_LABEL[c.reason] ?? c.reason}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.total}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{c.avg_days_to_caida}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <FalloutsAIAnalysis />
      </Section>

      {/* === 7. CICLO DE VENTA === */}
      <Section title="Ciclo de venta" subtitle="Días desde primer contacto hasta firma de boleto">
        {saleCycle.total === 0 ? (
          <Empty msg="No hay ventas cerradas todavía. Esto se va a poblar a medida que se aprueben operaciones." />
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs uppercase tracking-wider text-muted font-medium mb-2">Por vendedor</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                    <th className="px-3 py-2 font-medium">Vendedor</th>
                    <th className="px-3 py-2 font-medium text-right">Ventas</th>
                    <th className="px-3 py-2 font-medium text-right">Días promedio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {saleCycle.by_vendor.map(v => (
                    <tr key={v.vendedor_name}>
                      <td className="px-3 py-2 text-[#0F172A]">{v.vendedor_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.total}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.avg_days ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-muted font-medium mb-2">Por canal de origen</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                    <th className="px-3 py-2 font-medium">Canal</th>
                    <th className="px-3 py-2 font-medium text-right">Ventas</th>
                    <th className="px-3 py-2 font-medium text-right">Días promedio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {saleCycle.by_channel.map(c => (
                    <tr key={c.channel}>
                      <td className="px-3 py-2 text-[#0F172A]">{channelLabel(c.channel)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.total}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.avg_days ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* === 8. TENDENCIA MENSUAL === */}
      <Section title="Tendencia últimos 6 meses">
        {monthlyChartData.length === 0 ? (
          <Empty msg="Sin datos históricos todavía." />
        ) : (
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={monthlyChartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Leads" stroke="#94A3B8" strokeWidth={2} />
                <Line type="monotone" dataKey="Mensajes" stroke="#0EA5E9" strokeWidth={2} />
                <Line type="monotone" dataKey="Negociaciones" stroke="#F59E0B" strokeWidth={2} />
                <Line type="monotone" dataKey="Ventas" stroke="#10B981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <p className="text-[10px] text-muted text-center pt-4">
        Las analíticas se actualizan automáticamente cada vez que abrís esta página. Los datos son tiempo real.
      </p>
    </div>
  );
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

const StatCard = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }) => {
  const colors = {
    good: 'text-emerald-700',
    warn: 'text-amber-700',
    bad: 'text-red-600',
    neutral: 'text-[#0F172A]',
  };
  return (
    <div className="bg-white border border-border rounded-2xl p-5">
      <div className="text-muted text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${colors[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
};

const ForecastCard = ({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone: 'good' | 'warn' | 'neutral' }) => {
  const colors = { good: 'text-emerald-700', warn: 'text-amber-700', neutral: 'text-sky-700' };
  return (
    <div className="bg-white border border-border rounded-2xl p-4">
      <div className="text-muted text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${colors[tone]}`}>{fmtUSD(value)}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
};

const Section = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
  <div className="bg-white border border-border rounded-2xl p-5 md:p-6">
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-[#0F172A]">{title}</h2>
      {subtitle && <p className="text-muted text-xs mt-0.5">{subtitle}</p>}
    </div>
    {children}
  </div>
);

const Empty = ({ msg }: { msg: string }) => (
  <div className="text-center text-muted text-sm py-8">{msg}</div>
);

// Re-export para que el lint no se queje del import (KIND_LABEL se usa en PDF)
export { KIND_LABEL };

// ── Análisis IA de caídas ─────────────────────────────────────────────────

interface FalloutsAnalysis {
  summary: string;
  top_causes: Array<{ label: string; pct: number; action: string }>;
  patterns: string[];
  quick_wins: string[];
  sample_size: number;
}

const FalloutsAIAnalysis = () => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FalloutsAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke('analyze-fallouts', {
        body: { since: new Date(Date.now() - 90 * 86400000).toISOString() },
      });
      if (fnErr) throw fnErr;
      setData(res as FalloutsAnalysis);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 pt-4 border-t border-border">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-1.5">
            <span>✨</span> Análisis con IA
          </h3>
          <p className="text-xs text-muted">Claude lee las caídas de los últimos 90 días y resume causas raíz + acciones.</p>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="bg-crimson hover:bg-crimson-light text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
        >
          {loading ? 'Pensando…' : data ? 'Re-analizar' : 'Analizar'}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

      {data && (
        <div className="space-y-4">
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
            <p className="text-sm text-violet-900 leading-relaxed">{data.summary}</p>
            <p className="text-[10px] text-violet-700 mt-1">Muestra: {data.sample_size} caídas</p>
          </div>

          {data.top_causes.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">Top causas</h4>
              <div className="space-y-2">
                {data.top_causes.map((c, i) => (
                  <div key={i} className="bg-white border border-border rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-medium text-[#0F172A]">{c.label}</span>
                      <span className="text-xs font-bold text-crimson tabular-nums">{c.pct}%</span>
                    </div>
                    <div className="bg-bg-soft h-1.5 rounded-full overflow-hidden">
                      <div className="bg-crimson h-full" style={{ width: `${Math.min(100, c.pct)}%` }} />
                    </div>
                    <p className="text-xs text-muted mt-2">→ {c.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.patterns.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">Patrones detectados</h4>
              <ul className="space-y-1">
                {data.patterns.map((p, i) => (
                  <li key={i} className="text-sm text-[#0F172A] flex gap-2">
                    <span className="text-violet-500">•</span><span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.quick_wins.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">Quick wins (próxima semana)</h4>
              <ul className="space-y-1">
                {data.quick_wins.map((q, i) => (
                  <li key={i} className="text-sm text-[#0F172A] flex gap-2">
                    <span className="text-emerald-500">✓</span><span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
