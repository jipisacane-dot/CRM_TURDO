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
import type { Channel } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

const StatCard = ({ label, value, sub, color = 'text-white' }: { label: string; value: string | number; sub?: string; color?: string }) => (
  <div className="bg-bg-card border border-border rounded-2xl p-5">
    <div className="text-muted text-xs uppercase tracking-wider mb-2">{label}</div>
    <div className={`text-3xl font-bold ${color}`}>{value}</div>
    {sub && <div className="text-muted text-xs mt-1">{sub}</div>}
  </div>
);

const CHANNEL_COLORS: Record<Channel, string> = {
  whatsapp: '#25D366', instagram: '#E1306C', facebook: '#1877F2',
  email: '#EA4335', web: '#8B8B8B', zonaprop: '#F5A623',
  argenprop: '#4CAF50', mercadolibre: '#FFE600',
};

export default function Dashboard() {
  const { leads } = useApp();
  const navigate = useNavigate();

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newToday = leads.filter(l => new Date(l.createdAt) >= today).length;
    const unassigned = leads.filter(l => !l.assignedTo && l.status !== 'won' && l.status !== 'lost').length;
    const won = leads.filter(l => l.status === 'won').length;
    const active = leads.filter(l => l.status !== 'won' && l.status !== 'lost').length;
    return { total: leads.length, newToday, unassigned, won, active };
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

  return (
    <div className="p-5 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-muted text-sm mt-0.5">Resumen general · {new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Consultas totales" value={stats.total} sub="Histórico" />
        <StatCard label="Nuevas hoy" value={stats.newToday} sub="Últimas 24hs" color="text-blue-400" />
        <StatCard label="Sin asignar" value={stats.unassigned} sub="Requieren atención" color={stats.unassigned > 0 ? 'text-red-400' : 'text-green-400'} />
        <StatCard label="Cerrados" value={stats.won} sub="Operaciones ganadas" color="text-green-400" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Activos" value={stats.active} sub="En seguimiento" color="text-yellow-400" />
        <StatCard label="Propiedades" value={PROPERTIES.filter(p => p.active).length} sub="Publicadas activas" />
        <StatCard label="Vendedores" value={AGENTS.filter(a => a.role === 'agent').length} sub="En 2 sucursales" />
        <StatCard label="Total clics" value={PROPERTIES.reduce((s, p) => s + p.totalClicks, 0).toLocaleString('es-AR')} sub="Todos los portales" />
      </div>

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
