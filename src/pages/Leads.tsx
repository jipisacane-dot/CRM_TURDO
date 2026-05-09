import { useState, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { AGENTS } from '../data/mock';
import { ChannelIcon } from '../components/ui/ChannelIcon';
import { StatusBadge, statusConfig } from '../components/ui/StatusBadge';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import type { LeadStatus, Branch, Lead } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

const STATUSES: (LeadStatus | 'all')[] = ['all', 'new', 'contacted', 'qualified', 'proposal', 'visit', 'won', 'lost'];
const BRANCHES: (Branch | 'all')[] = ['all', 'Sucursal Centro', 'Sucursal Norte'];

export default function Leads() {
  const { leads, assignLead, updateLeadStatus, currentUser } = useApp();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');
  const [branchFilter, setBranchFilter] = useState<Branch | 'all'>('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [assigningLead, setAssigningLead] = useState<Lead | null>(null);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);

  const isAdmin = currentUser.role === 'admin';

  const filtered = useMemo(() => {
    // Vendedores filtran por currentUser.dbId (UUID real), NO por currentUser.id (mock string)
    const scope = isAdmin ? leads : leads.filter(l => currentUser.dbId && l.assignedTo === currentUser.dbId);
    return scope
      .filter(l => statusFilter === 'all' || l.status === statusFilter)
      .filter(l => branchFilter === 'all' || l.branch === branchFilter)
      .filter(l => !isAdmin || agentFilter === 'all' || l.assignedTo === agentFilter)
      .filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()) || (l.propertyTitle ?? '').toLowerCase().includes(search.toLowerCase()) || (l.phone ?? '').includes(search) || (l.email ?? '').includes(search))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [leads, isAdmin, currentUser.dbId, search, statusFilter, branchFilter, agentFilter]);

  return (
    <div className="p-5 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Consultas</h1>
        <p className="text-muted text-sm mt-0.5">{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar nombre, propiedad, contacto..."
          className="flex-1 min-w-[200px] bg-bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted outline-none focus:border-crimson"
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as LeadStatus | 'all')}
          className="bg-bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-crimson cursor-pointer">
          {STATUSES.map(s => <option key={s} value={s}>{s === 'all' ? 'Todos los estados' : statusConfig[s]?.label ?? s}</option>)}
        </select>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value as Branch | 'all')}
          className="bg-bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-crimson cursor-pointer">
          {BRANCHES.map(b => <option key={b} value={b}>{b === 'all' ? 'Todas las sucursales' : b}</option>)}
        </select>
        {isAdmin && (
          <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
            className="bg-bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-crimson cursor-pointer">
            <option value="all">Todos los vendedores</option>
            <option value="">Sin asignar</option>
            {AGENTS.filter(a => a.role === 'agent').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['Contacto', 'Canal', 'Propiedad', 'Estado', 'Vendedor', 'Sucursal', 'Hace'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-muted text-xs uppercase tracking-wider font-medium">{h}</th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => {
                const agent = AGENTS.find(a => a.id === lead.assignedTo);
                const unread = lead.messages.filter(m => !m.read && m.direction === 'in').length;
                return (
                  <tr key={lead.id} className="border-b border-border/50 hover:bg-bg-hover transition-colors cursor-pointer" onClick={() => setDetailLead(lead)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 bg-bg-input rounded-full flex items-center justify-center text-sm text-white font-semibold flex-shrink-0">
                          {lead.name[0]}
                        </div>
                        <div>
                          <div className="text-white text-sm font-medium flex items-center gap-1.5">
                            {lead.name}
                            {unread > 0 && <span className="bg-crimson-bright text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{unread}</span>}
                          </div>
                          <div className="text-muted text-xs">{lead.phone ?? lead.email ?? '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><ChannelIcon channel={lead.channel} size="sm" showLabel /></td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-300 max-w-[180px] truncate">{lead.propertyTitle ?? <span className="text-muted">—</span>}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                    <td className="px-4 py-3">
                      {agent ? (
                        <div className="flex items-center gap-2">
                          <Avatar initials={agent.avatar} size="xs" />
                          <span className="text-sm text-gray-300">{agent.name.split(' ')[0]}</span>
                        </div>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setAssigningLead(lead); }}
                          className="text-xs text-crimson-bright hover:underline bg-crimson/10 px-2 py-1 rounded-lg"
                        >
                          + Asignar
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted text-xs">{lead.branch}</td>
                    <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">{formatDistanceToNow(new Date(lead.createdAt), { locale: es, addSuffix: true })}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <select
                        value={lead.status}
                        onChange={e => updateLeadStatus(lead.id, e.target.value as LeadStatus)}
                        className="bg-bg-input border border-border rounded-lg px-2 py-1 text-xs text-white outline-none"
                      >
                        {STATUSES.filter(s => s !== 'all').map(s => (
                          <option key={s} value={s}>{statusConfig[s as LeadStatus]?.label ?? s}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center text-muted py-12">No se encontraron consultas</div>
          )}
        </div>
      </div>

      {/* Assign modal */}
      <Modal open={!!assigningLead} onClose={() => setAssigningLead(null)} title={`Asignar · ${assigningLead?.name}`}>
        <div className="space-y-2">
          {AGENTS.filter(a => a.role === 'agent').map(agent => (
            <button
              key={agent.id}
              onClick={() => { if (assigningLead) assignLead(assigningLead.id, agent.id); setAssigningLead(null); }}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-bg-hover hover:border-crimson transition-all"
            >
              <Avatar initials={agent.avatar} size="sm" />
              <div className="text-left flex-1">
                <div className="text-white text-sm font-medium">{agent.name}</div>
                <div className="text-muted text-xs">{agent.branch} · {agent.stats.active} activos · {agent.stats.conversionRate}% cierre</div>
              </div>
            </button>
          ))}
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal open={!!detailLead} onClose={() => setDetailLead(null)} title={detailLead?.name ?? ''} width="max-w-lg">
        {detailLead && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Canal', <ChannelIcon key="c" channel={detailLead.channel} size="sm" showLabel />],
                ['Estado', <StatusBadge key="s" status={detailLead.status} />],
                ['Teléfono', detailLead.phone ?? '—'],
                ['Email', detailLead.email ?? '—'],
                ['Sucursal', detailLead.branch],
                ['Propiedad', detailLead.propertyTitle ?? '—'],
              ].map(([label, val]) => (
                <div key={String(label)}>
                  <div className="text-muted text-xs mb-1">{label}</div>
                  <div className="text-white">{val}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="text-muted text-xs mb-2">Últimos mensajes</div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {detailLead.messages.slice(-4).map(m => (
                  <div key={m.id} className={`text-xs p-2.5 rounded-lg ${m.direction === 'in' ? 'bg-bg-input text-gray-300' : 'bg-crimson/20 text-crimson-50 text-right'}`}>
                    {m.content}
                  </div>
                ))}
              </div>
            </div>
            {detailLead.tags && detailLead.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {detailLead.tags.map(tag => (
                  <span key={tag} className="text-xs bg-bg-input text-muted px-2 py-0.5 rounded-full">{tag}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
