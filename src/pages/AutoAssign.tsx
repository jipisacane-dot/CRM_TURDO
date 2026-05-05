import { useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { assignmentApi, type AssignmentConfig, type AgentLoad } from '../services/assignment';

const ALL_CHANNELS = ['whatsapp', 'instagram', 'facebook', 'web', 'email', 'zonaprop', 'argenprop'];

export default function AutoAssign() {
  const { currentUser } = useApp();
  const [config, setConfig] = useState<AssignmentConfig | null>(null);
  const [agents, setAgents] = useState<AgentLoad[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [c, a] = await Promise.all([assignmentApi.getConfig(), assignmentApi.listAgentLoad()]);
      setConfig(c);
      setAgents(a);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (currentUser.role !== 'admin') {
    return (
      <div className="p-6">
        <div className="bg-white border border-border rounded-2xl p-4 text-sm text-muted">
          Esta sección es solo para administradores.
        </div>
      </div>
    );
  }

  const toggleEnabled = async () => {
    if (!config) return;
    setSaving('config');
    try {
      await assignmentApi.updateConfig({ enabled: !config.enabled });
      setConfig({ ...config, enabled: !config.enabled });
    } finally {
      setSaving(null);
    }
  };

  const updateAgent = async (agentId: string, patch: Parameters<typeof assignmentApi.updateCapacity>[1]) => {
    setSaving(agentId);
    try {
      await assignmentApi.updateCapacity(agentId, patch);
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, ...patch } as AgentLoad : a));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Auto-asignación de leads</h1>
        <p className="text-muted text-sm mt-0.5">
          Cuando entra un lead nuevo sin vendedor asignado, el sistema lo manda automáticamente al vendedor con menos carga (priorizando coincidencia de sucursal y canal).
        </p>
      </div>

      {loading ? (
        <div className="text-muted text-sm">Cargando…</div>
      ) : !config ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">No se pudo cargar la configuración.</div>
      ) : (
        <>
          {/* Toggle global */}
          <div className={`bg-white border rounded-2xl p-4 transition-colors ${config.enabled ? 'border-emerald-300' : 'border-border'}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-base font-semibold text-[#0F172A]">
                  {config.enabled ? '✅ Auto-asignación ACTIVA' : '⏸️ Auto-asignación PAUSADA'}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {config.enabled
                    ? 'Los leads nuevos se asignan al toque al vendedor con menos carga.'
                    : 'Los leads nuevos quedan sin asignar — Leticia los asigna a mano.'}
                </div>
              </div>
              <button
                onClick={toggleEnabled}
                disabled={saving === 'config'}
                className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${config.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${config.enabled ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            <div className="mt-3 text-xs text-muted">
              <strong>Estrategia actual:</strong> {strategyLabel(config.strategy)} ·{' '}
              <strong>Sucursal por defecto:</strong> {config.default_branch ?? '—'}
            </div>
          </div>

          {/* Lista de agentes con su capacity */}
          <div className="bg-white border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-bg-soft">
              <div className="text-sm font-semibold text-[#0F172A]">Capacidad por vendedor</div>
              <div className="text-xs text-muted">Configurá cuántos leads activos puede manejar cada uno y a qué canales/sucursal aplican.</div>
            </div>
            <div className="divide-y divide-border">
              {agents.map(a => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  saving={saving === a.id}
                  onPatch={p => updateAgent(a.id, p)}
                />
              ))}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-sm">
            <strong>Cómo elige el sistema:</strong> mismo branch primero · menor carga activa · prioridad más alta · luego round-robin (el que hace más tiempo no le toca).
          </div>
        </>
      )}
    </div>
  );
}

const AgentRow = ({ agent, saving, onPatch }: {
  agent: AgentLoad;
  saving: boolean;
  onPatch: (p: Parameters<typeof assignmentApi.updateCapacity>[1]) => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    available: agent.available ?? true,
    max_active_leads: agent.max_active_leads ?? 30,
    channels: agent.channels ?? ['whatsapp', 'instagram', 'facebook', 'web'],
    priority: agent.priority ?? 100,
  });

  const save = async () => {
    await onPatch(draft);
    setEditing(false);
  };

  const loadPct = agent.max_active_leads ? Math.min(100, Math.round((agent.active_leads / agent.max_active_leads) * 100)) : 0;
  const barColor = loadPct > 90 ? 'bg-red-500' : loadPct > 70 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => onPatch({ available: !agent.available })}
          disabled={saving}
          title={agent.available ? 'Disponible — recibe leads' : 'No disponible — pausado'}
          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${agent.available ? 'bg-emerald-500' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${agent.available ? 'translate-x-5' : ''}`} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-[#0F172A]">{agent.name}</span>
            <span className="text-[10px] text-muted bg-bg-soft px-2 py-0.5 rounded-full">{agent.branch ?? 'sin sucursal'}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1 max-w-[280px] bg-bg-soft rounded-full h-2 overflow-hidden">
              <div className={`h-full ${barColor} transition-all`} style={{ width: `${loadPct}%` }} />
            </div>
            <span className="text-[11px] text-muted whitespace-nowrap">
              {agent.active_leads}/{agent.max_active_leads ?? '?'} leads activos
            </span>
          </div>
        </div>

        <button onClick={() => setEditing(e => !e)} className="text-xs text-crimson hover:underline">
          {editing ? 'Cerrar' : 'Editar'}
        </button>
      </div>

      {editing && (
        <div className="mt-3 bg-bg-soft rounded-xl p-3 space-y-2">
          <label className="block text-xs text-muted">
            Máximo de leads activos:
            <input type="number" value={draft.max_active_leads}
              onChange={e => setDraft({ ...draft, max_active_leads: Number(e.target.value) })}
              className="ml-2 px-2 py-1 border border-border rounded w-20" />
          </label>
          <label className="block text-xs text-muted">
            Prioridad (mayor = se elige antes en empates):
            <input type="number" value={draft.priority}
              onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}
              className="ml-2 px-2 py-1 border border-border rounded w-20" />
          </label>
          <div className="text-xs text-muted">
            Canales:
            <div className="flex flex-wrap gap-1 mt-1">
              {ALL_CHANNELS.map(ch => {
                const checked = draft.channels.includes(ch);
                return (
                  <button
                    key={ch}
                    onClick={() => setDraft({
                      ...draft,
                      channels: checked
                        ? draft.channels.filter(c => c !== ch)
                        : [...draft.channels, ch],
                    })}
                    className={`text-[11px] px-2 py-1 rounded-full border ${checked ? 'bg-crimson text-white border-crimson' : 'bg-white border-border text-muted'}`}
                  >
                    {ch}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving} className="px-3 py-1 bg-crimson text-white rounded-lg text-xs">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setEditing(false)} className="px-3 py-1 bg-white border border-border rounded-lg text-xs">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function strategyLabel(s: string): string {
  switch (s) {
    case 'round_robin': return 'Round-robin (turnos rotativos)';
    case 'load_balanced': return 'Balanceado por carga';
    case 'manual': return 'Manual (sin auto-asignar)';
    default: return s;
  }
}
