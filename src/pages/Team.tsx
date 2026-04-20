import { useState, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { AGENTS } from '../data/mock';
import { Avatar } from '../components/ui/Avatar';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal } from '../components/ui/Modal';
import type { Branch } from '../types';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';

type Agent = typeof AGENTS[number];

const MetricBar = ({ label, value, max, color = '#8B1F1F' }: { label: string; value: number; max: number; color?: string }) => (
  <div>
    <div className="flex justify-between text-xs mb-1">
      <span className="text-muted">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
    <div className="h-1.5 bg-bg-input rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min((value / max) * 100, 100)}%`, background: color }} />
    </div>
  </div>
);

const AgentCard = ({ agent, leads, onClick }: { agent: Agent; leads: number; onClick: () => void }) => {
  const wonRate = agent.stats.total > 0 ? Math.round((agent.stats.won / agent.stats.total) * 100) : 0;
  return (
    <div onClick={onClick} className="bg-bg-card border border-border rounded-2xl p-5 cursor-pointer hover:border-crimson/50 transition-all group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Avatar initials={agent.avatar} size="lg" online={Math.random() > 0.4} />
          <div>
            <div className="text-white font-semibold group-hover:text-crimson-bright transition-colors">{agent.name}</div>
            <div className="text-muted text-xs mt-0.5">{agent.branch}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-white">{wonRate}%</div>
          <div className="text-muted text-[10px]">cierre</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Total', value: agent.stats.total, color: 'text-white' },
          { label: 'Activos', value: agent.stats.active, color: 'text-yellow-400' },
          { label: 'Ganados', value: agent.stats.won, color: 'text-green-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-bg-input rounded-xl p-2 text-center">
            <div className={`text-lg font-bold ${color}`}>{value}</div>
            <div className="text-muted text-[10px]">{label}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <MetricBar label="Consultas totales" value={agent.stats.total} max={150} />
        <MetricBar label="Operaciones ganadas" value={agent.stats.won} max={40} color="#22C55E" />
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border text-xs text-muted">
        <span>⏱ {agent.stats.responseTime} resp. prom.</span>
        <span>{leads} consultas asignadas</span>
      </div>
    </div>
  );
};

export default function Team() {
  const { leads } = useApp();
  const [branchFilter, setBranchFilter] = useState<Branch | 'all'>('all');
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);

  const agents = AGENTS.filter(a => a.role === 'agent');

  const agentLeads = useMemo(() => {
    const map: Record<string, number> = {};
    leads.forEach(l => { if (l.assignedTo) map[l.assignedTo] = (map[l.assignedTo] || 0) + 1; });
    return map;
  }, [leads]);

  const filtered = agents.filter(a => branchFilter === 'all' || a.branch === branchFilter);

  const summaryByBranch = useMemo(() => {
    return ['Sucursal Centro', 'Sucursal Norte'].map(branch => {
      const branchAgents = agents.filter(a => a.branch === branch);
      return {
        branch,
        agents: branchAgents.length,
        total: branchAgents.reduce((s, a) => s + a.stats.total, 0),
        active: branchAgents.reduce((s, a) => s + a.stats.active, 0),
        won: branchAgents.reduce((s, a) => s + a.stats.won, 0),
      };
    });
  }, [agents]);

  const radarData = detailAgent ? [
    { subject: 'Consultas', value: Math.min(Math.round((detailAgent.stats.total / 150) * 100), 100) },
    { subject: 'Cierre', value: detailAgent.stats.conversionRate },
    { subject: 'Velocidad', value: Math.max(0, 100 - parseInt(detailAgent.stats.responseTime) * 3) },
    { subject: 'Activos', value: Math.min(Math.round((detailAgent.stats.active / 30) * 100), 100) },
    { subject: 'Ganados', value: Math.min(Math.round((detailAgent.stats.won / 40) * 100), 100) },
  ] : [];

  const agentLeadList = useMemo(() => {
    if (!detailAgent) return [];
    return leads.filter(l => l.assignedTo === detailAgent.id).sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()).slice(0, 8);
  }, [detailAgent, leads]);

  return (
    <div className="p-5 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Equipo</h1>
        <p className="text-muted text-sm mt-0.5">2 sucursales · {agents.length} vendedores</p>
      </div>

      {/* Branch summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {summaryByBranch.map(b => (
          <div key={b.branch} className="bg-bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold">{b.branch}</h3>
              <span className="text-muted text-sm">{b.agents} vendedores</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="text-xl font-bold text-white">{b.total}</div><div className="text-muted text-xs">Total</div></div>
              <div><div className="text-xl font-bold text-yellow-400">{b.active}</div><div className="text-muted text-xs">Activos</div></div>
              <div><div className="text-xl font-bold text-green-400">{b.won}</div><div className="text-muted text-xs">Ganados</div></div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-3">
        <div className="flex bg-bg-card border border-border rounded-xl overflow-hidden">
          {(['all', 'Sucursal Centro', 'Sucursal Norte'] as const).map(b => (
            <button key={b} onClick={() => setBranchFilter(b)}
              className={`px-4 py-2.5 text-sm transition-all ${branchFilter === b ? 'bg-crimson text-white' : 'text-muted hover:text-white'}`}>
              {b === 'all' ? 'Todas' : b.replace('Sucursal ', '')}
            </button>
          ))}
        </div>
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(agent => (
          <AgentCard key={agent.id} agent={agent} leads={agentLeads[agent.id] ?? 0} onClick={() => setDetailAgent(agent)} />
        ))}
      </div>

      {/* Agent detail modal */}
      <Modal open={!!detailAgent} onClose={() => setDetailAgent(null)} title={detailAgent?.name ?? ''} width="max-w-2xl">
        {detailAgent && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <Avatar initials={detailAgent.avatar} size="lg" />
              <div>
                <div className="text-white font-bold text-lg">{detailAgent.name}</div>
                <div className="text-muted text-sm">{detailAgent.branch}</div>
                <div className="text-muted text-xs mt-0.5">{detailAgent.email} · {detailAgent.phone}</div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3 text-center">
              {[
                { label: 'Consultas', value: detailAgent.stats.total, color: 'text-white' },
                { label: 'Activos', value: detailAgent.stats.active, color: 'text-yellow-400' },
                { label: 'Ganados', value: detailAgent.stats.won, color: 'text-green-400' },
                { label: 'Perdidos', value: detailAgent.stats.lost, color: 'text-red-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-bg-input rounded-xl p-3">
                  <div className={`text-2xl font-bold ${color}`}>{value}</div>
                  <div className="text-muted text-xs mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-bg-input rounded-xl p-3 text-center">
                <div className="text-white font-bold text-xl">{detailAgent.stats.conversionRate}%</div>
                <div className="text-muted text-xs">Tasa de cierre</div>
              </div>
              <div className="bg-bg-input rounded-xl p-3 text-center">
                <div className="text-white font-bold text-xl">{detailAgent.stats.responseTime}</div>
                <div className="text-muted text-xs">Tiempo de respuesta</div>
              </div>
            </div>

            <div>
              <h4 className="text-white font-semibold text-sm mb-2">Rendimiento</h4>
              <ResponsiveContainer width="100%" height={180}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#2E2E2E" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#666', fontSize: 11 }} />
                  <Radar dataKey="value" fill="#8B1F1F" fillOpacity={0.4} stroke="#8B1F1F" />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {agentLeadList.length > 0 && (
              <div>
                <h4 className="text-white font-semibold text-sm mb-2">Consultas recientes</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {agentLeadList.map(lead => (
                    <div key={lead.id} className="flex items-center gap-3 p-2.5 bg-bg-input rounded-xl">
                      <div className="w-7 h-7 bg-bg-hover rounded-full flex items-center justify-center text-xs text-white flex-shrink-0">{lead.name[0]}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-xs font-medium truncate">{lead.name}</div>
                        <div className="text-muted text-[10px] truncate">{lead.propertyTitle ?? 'Sin propiedad'}</div>
                      </div>
                      <StatusBadge status={lead.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
