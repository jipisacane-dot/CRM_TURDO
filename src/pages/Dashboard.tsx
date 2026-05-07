import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { useApp } from '../contexts/AppContext';
import { AGENTS, PROPERTIES } from '../data/mock';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ChannelIcon } from '../components/ui/ChannelIcon';
import { Avatar } from '../components/ui/Avatar';
import type { Channel, Lead } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import PageHeader from '../components/ui/PageHeader';

const HOUR = 60 * 60 * 1000;

// First response time in ms — undefined if vendor never replied
const firstResponseMs = (l: Lead): number | undefined => {
  const firstIn = l.messages.find(m => m.direction === 'in');
  const firstOut = l.messages.find(m => m.direction === 'out');
  if (!firstIn || !firstOut) return undefined;
  const diff = new Date(firstOut.timestamp).getTime() - new Date(firstIn.timestamp).getTime();
  return diff >= 0 ? diff : undefined;
};

const msToHuman = (ms: number): string => {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60000))} min`;
  if (ms < 24 * HOUR) return `${Math.round(ms / HOUR * 10) / 10} h`;
  return `${Math.round(ms / (24 * HOUR))} d`;
};

const StatCard = ({ label, value, sub, color = 'text-[#0F172A]', icon }: { label: string; value: string | number; sub?: string; color?: string; icon?: string }) => (
  <div className="bg-white border border-border rounded-2xl p-4 md:p-5 hover:border-crimson/30 transition-colors">
    <div className="flex items-start justify-between gap-2 mb-2">
      <div className="text-muted text-[11px] uppercase tracking-wider font-medium leading-tight">{label}</div>
      {icon && <span className="text-xl flex-shrink-0">{icon}</span>}
    </div>
    <div className={`text-2xl md:text-3xl font-bold tabular-nums ${color}`}>{value}</div>
    {sub && <div className="text-muted text-xs mt-1 truncate">{sub}</div>}
  </div>
);

interface AlertCardProps {
  accent: string;
  label: string;
  count: number;
  leads: Lead[];
  hint: string;
  badgeColor: string;
  onClick: () => void;
  timeFn: (l: Lead) => string;
}

const AlertCard = ({ accent, label, count, leads, hint, badgeColor, onClick, timeFn }: AlertCardProps) => (
  <div
    onClick={onClick}
    className={`${accent} border rounded-2xl p-4 cursor-pointer hover:opacity-90 transition-all`}
  >
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-700">{label}</span>
      <span className={`text-2xl font-bold ${badgeColor}`}>{count}</span>
    </div>
    <div className="text-xs text-gray-600 mb-3">{hint}</div>
    <div className="space-y-1.5">
      {leads.map(l => (
        <div key={l.id} className="flex items-center justify-between text-xs bg-white/60 rounded-lg px-2.5 py-1.5">
          <span className="text-gray-800 font-medium truncate flex-1">{l.name}</span>
          <span className="text-gray-500 text-[10px] flex-shrink-0 ml-2 truncate max-w-[50%]">{timeFn(l)}</span>
        </div>
      ))}
      {leads.length === 0 && <div className="text-xs text-gray-500 italic">Sin pendientes</div>}
    </div>
  </div>
);

const CHANNEL_COLORS: Record<Channel, string> = {
  whatsapp: '#25D366', instagram: '#E1306C', facebook: '#1877F2',
  email: '#EA4335', web: '#8B8B8B', zonaprop: '#F5A623',
  argenprop: '#4CAF50', mercadolibre: '#FFE600',
};

export default function Dashboard() {
  const { leads, currentUser } = useApp();
  const navigate = useNavigate();
  const isAdmin = currentUser.role === 'admin';

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newToday = leads.filter(l => new Date(l.createdAt) >= today).length;
    const unassigned = leads.filter(l => !l.assignedTo && l.status !== 'won' && l.status !== 'lost').length;
    const won = leads.filter(l => l.status === 'won').length;
    const active = leads.filter(l => l.status !== 'won' && l.status !== 'lost').length;
    return { total: leads.length, newToday, unassigned, won, active };
  }, [leads]);

  // ── Follow-up alerts (admin only) ─────────────────────────────────────────
  const followUp = useMemo(() => {
    const now = Date.now();
    const activeLeads = leads.filter(l => l.status !== 'won' && l.status !== 'lost');

    const unassigned = activeLeads
      .filter(l => !l.assignedTo)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Assigned leads where vendor hasn't responded yet (no 'out' message)
    const noReply = activeLeads
      .filter(l => l.assignedTo && !l.messages.some(m => m.direction === 'out'))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Stale: last activity older than 24h, still active
    const stale = activeLeads
      .filter(l => now - new Date(l.lastActivity).getTime() > 24 * HOUR)
      .sort((a, b) => new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime());

    // Critical: no reply AND assigned more than 4h ago
    const critical = noReply.filter(l => now - new Date(l.createdAt).getTime() > 4 * HOUR);

    return { unassigned, noReply, stale, critical };
  }, [leads]);

  // ── Per-agent real performance ────────────────────────────────────────────
  const agentPerformance = useMemo(() => {
    return AGENTS.filter(a => a.role === 'agent').map(a => {
      const mine = leads.filter(l => l.assignedTo === a.id);
      const active = mine.filter(l => l.status !== 'won' && l.status !== 'lost').length;
      const won = mine.filter(l => l.status === 'won').length;
      const cold = mine.filter(l => {
        if (l.status === 'won' || l.status === 'lost') return false;
        return Date.now() - new Date(l.lastActivity).getTime() > 24 * HOUR;
      }).length;
      const responseTimes = mine.map(firstResponseMs).filter((x): x is number => x !== undefined);
      const avgResponse = responseTimes.length > 0
        ? responseTimes.reduce((s, n) => s + n, 0) / responseTimes.length
        : undefined;
      const noReplyYet = mine.filter(l =>
        l.status !== 'won' && l.status !== 'lost' && !l.messages.some(m => m.direction === 'out')
      ).length;
      return {
        id: a.id, name: a.name, avatar: a.avatar,
        total: mine.length, active, won, cold, avgResponse, noReplyYet,
      };
    }).sort((a, b) => b.active - a.active);
  }, [leads]);

  const channelData = useMemo(() => {
    const map: Record<string, number> = {};
    leads.forEach(l => { map[l.channel] = (map[l.channel] || 0) + 1; });
    return Object.entries(map).map(([channel, count]) => ({ channel, count, fill: CHANNEL_COLORS[channel as Channel] || '#888' }));
  }, [leads]);

  const agentData = useMemo(() =>
    AGENTS.filter(a => a.role === 'agent').map(a => ({
      name: a.name.split(' ')[0],
      total: a.stats.total,
      won: a.stats.won,
      active: a.stats.active,
    })),
    []
  );

  const recentLeads = useMemo(() =>
    [...leads].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6),
    [leads]
  );

  const topProperties = useMemo(() =>
    [...PROPERTIES].filter(p => p.active).sort((a, b) => b.totalLeads - a.totalLeads).slice(0, 4),
    []
  );

  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const firstName = currentUser.name.split(' ')[0];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl">
      <PageHeader
        title={`Hola ${firstName} 👋`}
        subtitle={`${today.charAt(0).toUpperCase() + today.slice(1)} · ${isAdmin ? 'panel de administración' : 'tu día en Turdo'}`}
      />

      {/* KPI principal — 4 cards de impacto */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Sin asignar"
          value={stats.unassigned}
          sub={stats.unassigned > 0 ? 'Requieren atención' : 'Todo asignado ✓'}
          color={stats.unassigned > 0 ? 'text-rose-600' : 'text-emerald-600'}
          icon="📥"
        />
        <StatCard
          label="Nuevas hoy"
          value={stats.newToday}
          sub="Últimas 24hs"
          color="text-blue-600"
          icon="✨"
        />
        <StatCard
          label="Activos"
          value={stats.active}
          sub="En seguimiento"
          color="text-amber-600"
          icon="🔥"
        />
        <StatCard
          label="Cerrados"
          value={stats.won}
          sub="Operaciones ganadas"
          color="text-emerald-600"
          icon="🏆"
        />
      </div>

      {/* KPI secundario — datos contextuales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Consultas totales" value={stats.total} sub="Histórico" />
        <StatCard label="Propiedades" value={PROPERTIES.filter(p => p.active).length} sub="Publicadas activas" />
        <StatCard label="Vendedores" value={AGENTS.filter(a => a.role === 'agent').length} sub="En 2 sucursales" />
        <StatCard label="Total clics" value={PROPERTIES.reduce((s, p) => s + p.totalClicks, 0).toLocaleString('es-AR')} sub="Todos los portales" />
      </div>

      {/* ── Follow-up alerts (admin only) ──────────────────────────────────── */}
      {isAdmin && (followUp.unassigned.length > 0 || followUp.noReply.length > 0 || followUp.stale.length > 0) && (
        <div className="bg-white border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[#0F172A] font-semibold flex items-center gap-2">
                <span>🚨</span> Alertas de seguimiento
              </h3>
              <p className="text-muted text-xs mt-0.5">Leads que requieren acción — no los pierdas</p>
            </div>
            <button onClick={() => navigate('/inbox')} className="text-crimson-bright text-xs hover:underline">Ir a bandeja →</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Sin asignar */}
            <AlertCard
              accent="bg-red-50 border-red-200"
              label="Sin asignar"
              count={followUp.unassigned.length}
              leads={followUp.unassigned.slice(0, 3)}
              onClick={() => navigate('/inbox')}
              hint="Leticia tiene que asignar"
              badgeColor="text-red-600"
              timeFn={l => `Llegó ${formatDistanceToNow(new Date(l.createdAt), { locale: es, addSuffix: true })}`}
            />
            {/* Sin primera respuesta */}
            <AlertCard
              accent="bg-amber-50 border-amber-200"
              label="Sin primera respuesta"
              count={followUp.noReply.length}
              leads={followUp.noReply.slice(0, 3)}
              onClick={() => navigate('/inbox')}
              hint={followUp.critical.length > 0 ? `${followUp.critical.length} con más de 4hs` : 'Asignados sin contestar'}
              badgeColor="text-amber-700"
              timeFn={l => {
                const agent = AGENTS.find(a => a.id === l.assignedTo);
                return `${agent?.name.split(' ')[0] ?? '?'} · ${formatDistanceToNow(new Date(l.createdAt), { locale: es })}`;
              }}
            />
            {/* Leads fríos */}
            <AlertCard
              accent="bg-blue-50 border-blue-200"
              label="Fríos (+24hs sin actividad)"
              count={followUp.stale.length}
              leads={followUp.stale.slice(0, 3)}
              onClick={() => navigate('/inbox')}
              hint="Retomá el contacto"
              badgeColor="text-blue-700"
              timeFn={l => {
                const agent = AGENTS.find(a => a.id === l.assignedTo);
                return `${agent?.name.split(' ')[0] ?? 'Sin asignar'} · ${formatDistanceToNow(new Date(l.lastActivity), { locale: es })}`;
              }}
            />
          </div>
        </div>
      )}

      {/* ── Real per-agent performance (admin only) ─────────────────────────── */}
      {isAdmin && (
        <div className="bg-bg-card border border-border rounded-2xl p-5">
          <h3 className="text-white font-semibold mb-4">Performance del equipo</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 text-xs text-muted font-medium uppercase tracking-wider">Vendedor</th>
                  <th className="text-right px-3 py-2 text-xs text-muted font-medium uppercase tracking-wider">Activos</th>
                  <th className="text-right px-3 py-2 text-xs text-muted font-medium uppercase tracking-wider">Sin contestar</th>
                  <th className="text-right px-3 py-2 text-xs text-muted font-medium uppercase tracking-wider">Fríos</th>
                  <th className="text-right px-3 py-2 text-xs text-muted font-medium uppercase tracking-wider">1ra respuesta</th>
                  <th className="text-right px-3 py-2 text-xs text-muted font-medium uppercase tracking-wider">Ganados</th>
                </tr>
              </thead>
              <tbody>
                {agentPerformance.map(a => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-bg-hover/40 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar initials={a.avatar} size="xs" />
                        <span className="text-white text-sm font-medium">{a.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-300">{a.active}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={a.noReplyYet > 0 ? 'text-amber-600 font-semibold' : 'text-muted'}>{a.noReplyYet}</span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={a.cold > 0 ? 'text-blue-600 font-semibold' : 'text-muted'}>{a.cold}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-300">
                      {a.avgResponse !== undefined ? msToHuman(a.avgResponse) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-green-600 font-medium">{a.won}</td>
                  </tr>
                ))}
                {agentPerformance.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-muted py-8 text-sm">Sin vendedores cargados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-bg-card border border-border rounded-2xl p-5">
          <h3 className="text-white font-semibold mb-4">Consultas por vendedor</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={agentData} barGap={2}>
              <XAxis dataKey="name" tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, color: '#111827' }} />
              <Bar dataKey="total" fill="#8B1F1F" radius={4} name="Total" />
              <Bar dataKey="won" fill="#22C55E" radius={4} name="Ganados" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-bg-card border border-border rounded-2xl p-5">
          <h3 className="text-white font-semibold mb-4">Canales de entrada</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={channelData} dataKey="count" nameKey="channel" cx="50%" cy="50%" outerRadius={75} label={(entry: { name?: string; percent?: number }) => `${entry.name ?? ''} ${((entry.percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                {channelData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, color: '#111827' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent leads + top properties */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Últimas consultas</h3>
            <button onClick={() => navigate('/leads')} className="text-crimson-bright text-xs hover:underline">Ver todas →</button>
          </div>
          <div className="space-y-2">
            {recentLeads.map(lead => {
              const agent = AGENTS.find(a => a.id === lead.assignedTo);
              return (
                <div
                  key={lead.id}
                  onClick={() => navigate('/leads')}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-bg-hover cursor-pointer transition-all"
                >
                  <div className="w-8 h-8 bg-bg-input rounded-full flex items-center justify-center text-sm flex-shrink-0">
                    {lead.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-medium truncate">{lead.name}</span>
                      <ChannelIcon channel={lead.channel} size="sm" />
                    </div>
                    <div className="text-muted text-xs truncate">{lead.propertyTitle ?? 'Sin propiedad asignada'}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <StatusBadge status={lead.status} />
                    <span className="text-muted text-[10px]">{formatDistanceToNow(new Date(lead.createdAt), { locale: es, addSuffix: true })}</span>
                  </div>
                  {!lead.assignedTo && (
                    <span className="text-xs bg-crimson/20 text-crimson-bright px-2 py-0.5 rounded-full flex-shrink-0">Sin asignar</span>
                  )}
                  {agent && <Avatar initials={agent.avatar} size="xs" />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Top propiedades</h3>
            <button onClick={() => navigate('/properties')} className="text-crimson-bright text-xs hover:underline">Ver todas →</button>
          </div>
          <div className="space-y-3">
            {topProperties.map(p => (
              <div key={p.id} className="p-3 rounded-xl hover:bg-bg-hover cursor-pointer transition-all" onClick={() => navigate('/properties')}>
                <div className="text-white text-sm font-medium line-clamp-1">{p.title}</div>
                <div className="text-muted text-xs mt-0.5 line-clamp-1">{p.address}</div>
                <div className="flex gap-3 mt-2">
                  <span className="text-xs text-blue-400">👁 {p.totalClicks} clics</span>
                  <span className="text-xs text-yellow-400">📩 {p.totalLeads} consultas</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
