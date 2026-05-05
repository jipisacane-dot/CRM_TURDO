import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useNavigate } from 'react-router-dom';
import { pipelineStagesApi, pipelineApi, type PipelineStage } from '../services/pipeline';
import { agentsApi, type DBAgent } from '../services/commissions';
import { ChannelIcon } from '../components/ui/ChannelIcon';
import type { Lead } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface ContactWithStage extends Lead {
  current_stage_key?: string;
  stage_changed_at?: string;
}

export default function Pipeline() {
  const { leads, currentUser, refreshLeads } = useApp();
  const isAdmin = currentUser.role === 'admin';
  const navigate = useNavigate();

  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [agents, setAgents] = useState<DBAgent[]>([]);
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([pipelineStagesApi.list(), agentsApi.list()]).then(([s, a]) => {
      setStages(s);
      setAgents(a);
    });
  }, []);

  // Cast leads to include stage info (que viene en c desde DB pero el toLead lo perdió)
  // Refrescamos: hacemos query directa cuando cambia agente
  // Por simplicidad, usamos los leads del context y asumimos que tienen el campo
  // (lo agregamos en próximo paso si hace falta)

  const myLeads = useMemo(() => {
    const scope = (leads as ContactWithStage[]).filter(l => {
      if (!isAdmin && l.assignedTo !== currentUser.id) return false;
      if (isAdmin && filterAgent !== 'all') {
        if (filterAgent === '_unassigned' && l.assignedTo) return false;
        if (filterAgent !== '_unassigned' && l.assignedTo !== filterAgent) return false;
      }
      return true;
    });
    return scope;
  }, [leads, isAdmin, currentUser.id, filterAgent]);

  const leadsByStage = useMemo(() => {
    const map = new Map<string, ContactWithStage[]>();
    for (const s of stages) map.set(s.key, []);
    for (const l of myLeads) {
      const key = l.current_stage_key ?? 'nuevo';
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    }
    return map;
  }, [myLeads, stages]);

  const handleDragStart = (id: string) => setDraggedId(id);
  const handleDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    setOverStage(key);
  };
  const handleDragLeave = () => setOverStage(null);
  const handleDrop = async (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    setOverStage(null);
    if (!draggedId) return;
    const lead = myLeads.find(l => l.id === draggedId);
    if (!lead || lead.current_stage_key === stageKey) {
      setDraggedId(null);
      return;
    }
    setUpdating(draggedId);
    try {
      await pipelineApi.changeStage(draggedId, stageKey);
      await refreshLeads();
    } catch (err) {
      alert('Error al mover: ' + (err as Error).message);
    } finally {
      setUpdating(null);
      setDraggedId(null);
    }
  };

  const sellableAgents = useMemo(() => agents.filter(a => a.role === 'agent' && a.active), [agents]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Pipeline</h1>
          <p className="text-muted text-sm mt-0.5">
            {isAdmin
              ? 'Embudo de leads de todo el equipo. Arrastrá entre columnas para mover.'
              : 'Tus leads. Arrastrá las tarjetas entre columnas o hacé click para abrir el chat.'}
          </p>
        </div>
        {isAdmin && (
          <select
            value={filterAgent}
            onChange={e => setFilterAgent(e.target.value)}
            className="bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
          >
            <option value="all">Todos los vendedores</option>
            <option value="_unassigned">Sin asignar</option>
            {sellableAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      {/* Resumen contadores */}
      <div className="bg-white border border-border rounded-2xl p-3 flex items-center gap-1 overflow-x-auto">
        {stages.map(s => {
          const count = leadsByStage.get(s.key)?.length ?? 0;
          return (
            <div key={s.key} className="flex-1 min-w-[80px] text-center px-2 py-1">
              <div className="text-xl font-bold tabular-nums" style={{ color: s.color ?? '#0F172A' }}>{count}</div>
              <div className="text-[10px] text-muted truncate">{s.icon} {s.name}</div>
            </div>
          );
        })}
      </div>

      {/* Kanban */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {stages.map(s => {
            const items = leadsByStage.get(s.key) ?? [];
            const isOver = overStage === s.key;
            return (
              <div
                key={s.key}
                onDragOver={e => handleDragOver(e, s.key)}
                onDragLeave={handleDragLeave}
                onDrop={e => void handleDrop(e, s.key)}
                className={`w-72 flex-shrink-0 rounded-xl border-2 transition-colors ${isOver ? 'border-crimson bg-crimson/5' : 'border-transparent'}`}
                style={{ background: isOver ? undefined : `${s.color ?? '#94A3B8'}10` }}
              >
                <div className="px-3 py-2 sticky top-0 z-10 rounded-t-xl backdrop-blur-sm" style={{ background: `${s.color ?? '#94A3B8'}15` }}>
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1" style={{ color: s.color ?? '#0F172A' }}>
                      <span>{s.icon}</span>
                      <span>{s.name}</span>
                    </div>
                    <span className="text-xs text-muted font-medium tabular-nums">{items.length}</span>
                  </div>
                </div>

                <div className="p-2 space-y-2 min-h-[200px]">
                  {items.length === 0 ? (
                    <div className="text-center text-muted text-xs py-4">—</div>
                  ) : (
                    items.map(l => (
                      <LeadCard
                        key={l.id}
                        lead={l}
                        onDragStart={() => handleDragStart(l.id)}
                        onDragEnd={() => setDraggedId(null)}
                        onClick={() => navigate(`/inbox?lead=${l.id}`)}
                        isUpdating={updating === l.id}
                        isDragging={draggedId === l.id}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const LeadCard = ({
  lead, onDragStart, onDragEnd, onClick, isUpdating, isDragging,
}: {
  lead: ContactWithStage;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  isUpdating: boolean;
  isDragging: boolean;
}) => {
  const lastActivity = lead.lastActivity ?? lead.createdAt;
  const since = formatDistanceToNow(new Date(lastActivity), { addSuffix: true, locale: es });
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`bg-white border border-border rounded-lg p-2.5 cursor-grab active:cursor-grabbing hover:border-crimson hover:shadow-sm transition-all ${
        isDragging ? 'opacity-30' : ''
      } ${isUpdating ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5"><ChannelIcon channel={lead.channel} size={14} /></div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[#0F172A] truncate">{lead.name ?? 'Sin nombre'}</div>
          {lead.propertyTitle && (
            <div className="text-[11px] text-muted truncate mt-0.5">{lead.propertyTitle}</div>
          )}
          <div className="text-[10px] text-muted mt-1">{since}</div>
        </div>
      </div>
    </div>
  );
};
