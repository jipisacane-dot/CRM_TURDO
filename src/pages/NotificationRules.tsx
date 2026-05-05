import { useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { notificationsApi, type NotificationRule, type NotificationRuleUpdate } from '../services/notifications';

const RULE_HINTS: Record<string, string> = {
  agent_no_reply_15min: 'Cuando el cliente escribe y el vendedor no responde en N minutos.',
  agent_no_reply_4h: 'Si pasan más horas sin que el vendedor responda, también se avisa a la admin.',
  cold_24h: 'Lead asignado sin actividad N minutos. No aplica a leads sin asignar.',
  paused_followup: 'Leads en pausa que cumplen N días sin moverse.',
  visit_reminder_1h: 'Recordatorio antes de una visita programada (usa la tabla de reminders).',
};

export default function NotificationRulesPage() {
  const { currentUser } = useApp();
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [dryRunOpen, setDryRunOpen] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{ sent: number; log: string[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRules(await notificationsApi.list());
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

  const onPatch = async (ruleKey: string, patch: NotificationRuleUpdate) => {
    setSaving(ruleKey);
    try {
      await notificationsApi.update(ruleKey, patch);
      setRules(prev => prev.map(r => r.rule_key === ruleKey ? { ...r, ...patch } : r));
    } catch (e) {
      alert('Error al guardar: ' + (e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const onDryRun = async () => {
    setDryRunOpen(true);
    setDryRunResult(null);
    try {
      const r = await notificationsApi.dryRun();
      setDryRunResult({ sent: r.sent, log: r.log });
    } catch (e) {
      setDryRunResult({ sent: 0, log: ['ERROR: ' + (e as Error).message] });
    }
  };

  const enabledCount = rules.filter(r => r.enabled).length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Reglas de notificaciones</h1>
          <p className="text-muted text-sm mt-0.5">
            Configurá cuándo el sistema manda push automáticos al equipo. {enabledCount} de {rules.length} reglas activas.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onDryRun}
            className="px-3 py-2 text-sm bg-white border border-border rounded-xl hover:bg-bg-soft text-[#0F172A]"
          >
            Probar (dry-run)
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-sm">
        <strong>Cómo funciona:</strong> el motor corre cada 15 min y procesa todas las reglas activas. Para cada lead que cumple, manda push al asignado (y opcionalmente a la admin). Cooldown automático para no repetir el mismo aviso al mismo lead. Tocá <em>"Probar"</em> arriba para simular sin mandar pushes reales.
      </div>

      {loading ? (
        <div className="text-muted text-sm">Cargando…</div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <RuleCard key={rule.rule_key} rule={rule} saving={saving === rule.rule_key} onPatch={p => onPatch(rule.rule_key, p)} />
          ))}
        </div>
      )}

      {dryRunOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDryRunOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-[#0F172A]">Resultado del dry-run</div>
                <div className="text-xs text-muted">Lo que se mandaría si las reglas estuvieran activas. NO se mandaron pushes reales.</div>
              </div>
              <button onClick={() => setDryRunOpen(false)} className="text-muted hover:text-[#0F172A]">✕</button>
            </div>
            <div className="p-4 text-sm">
              {!dryRunResult ? (
                <div className="text-muted">Procesando…</div>
              ) : (
                <>
                  <div className="mb-3 text-[#0F172A] font-medium">
                    Notificaciones simuladas: {dryRunResult.sent}
                  </div>
                  <div className="bg-bg-soft rounded-xl p-3 max-h-96 overflow-y-auto">
                    {dryRunResult.log.length === 0 ? (
                      <div className="text-muted text-xs">Sin actividad — ninguna regla matcheó.</div>
                    ) : (
                      <pre className="text-[11px] leading-snug whitespace-pre-wrap font-mono">{dryRunResult.log.join('\n')}</pre>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const RuleCard = ({ rule, saving, onPatch }: {
  rule: NotificationRule;
  saving: boolean;
  onPatch: (p: NotificationRuleUpdate) => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NotificationRuleUpdate>({});

  const startEdit = () => {
    setDraft({
      threshold_minutes: rule.threshold_minutes,
      cooldown_hours: rule.cooldown_hours,
      notify_assigned_agent: rule.notify_assigned_agent,
      notify_admin: rule.notify_admin,
    });
    setEditing(true);
  };

  const save = async () => {
    await onPatch(draft);
    setEditing(false);
  };

  return (
    <div className={`bg-white border rounded-2xl p-4 transition-colors ${rule.enabled ? 'border-emerald-300' : 'border-border'}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onPatch({ enabled: !rule.enabled })}
          disabled={saving}
          className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${rule.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
          aria-pressed={rule.enabled}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${rule.enabled ? 'translate-x-5' : ''}`} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-base font-semibold text-[#0F172A]">{rule.name}</div>
            <code className="text-[10px] text-muted">{rule.rule_key}</code>
          </div>
          {rule.description && (
            <div className="text-sm text-muted mt-1">{rule.description}</div>
          )}
          {RULE_HINTS[rule.rule_key] && (
            <div className="text-xs text-muted/80 italic mt-1">{RULE_HINTS[rule.rule_key]}</div>
          )}

          <div className="mt-3 flex items-center gap-3 flex-wrap text-xs">
            {rule.threshold_minutes !== null && (
              <Pill label="Disparar a los" value={fmtMinutes(rule.threshold_minutes)} />
            )}
            <Pill label="Cooldown" value={`${rule.cooldown_hours} h`} />
            <Pill label="Avisa a" value={[
              rule.notify_assigned_agent && 'vendedor',
              rule.notify_admin && 'admin',
            ].filter(Boolean).join(' + ') || '—'} />
            {rule.applies_to_stages.length > 0 && (
              <Pill label="Etapas" value={`${rule.applies_to_stages.length}`} />
            )}
            {Object.keys(rule.config ?? {}).length > 0 && (
              <Pill label="Config" value={JSON.stringify(rule.config).slice(0, 30)} />
            )}
          </div>

          {editing ? (
            <div className="mt-3 space-y-2 bg-bg-soft rounded-xl p-3">
              {rule.threshold_minutes !== null && (
                <label className="block text-xs text-muted">
                  Disparar a los (minutos):
                  <input
                    type="number"
                    value={draft.threshold_minutes ?? rule.threshold_minutes}
                    onChange={e => setDraft({ ...draft, threshold_minutes: Number(e.target.value) })}
                    className="ml-2 px-2 py-1 border border-border rounded w-24"
                  />
                </label>
              )}
              <label className="block text-xs text-muted">
                Cooldown (horas, evitar repetir):
                <input
                  type="number"
                  value={draft.cooldown_hours ?? rule.cooldown_hours}
                  onChange={e => setDraft({ ...draft, cooldown_hours: Number(e.target.value) })}
                  className="ml-2 px-2 py-1 border border-border rounded w-24"
                />
              </label>
              <label className="block text-xs text-muted">
                <input
                  type="checkbox"
                  checked={draft.notify_assigned_agent ?? rule.notify_assigned_agent}
                  onChange={e => setDraft({ ...draft, notify_assigned_agent: e.target.checked })}
                  className="mr-2"
                />
                Avisar al vendedor asignado
              </label>
              <label className="block text-xs text-muted">
                <input
                  type="checkbox"
                  checked={draft.notify_admin ?? rule.notify_admin}
                  onChange={e => setDraft({ ...draft, notify_admin: e.target.checked })}
                  className="mr-2"
                />
                Avisar también a la admin (Leticia)
              </label>
              <div className="flex gap-2 pt-1">
                <button onClick={save} disabled={saving} className="px-3 py-1 bg-crimson text-white rounded-lg text-xs">
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button onClick={() => setEditing(false)} className="px-3 py-1 bg-white border border-border rounded-lg text-xs">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button onClick={startEdit} className="mt-2 text-xs text-crimson hover:underline">
              Editar
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Pill = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-bg-soft px-2 py-1 rounded-full">
    <span className="text-muted">{label}:</span> <span className="text-[#0F172A] font-medium">{value}</span>
  </div>
);

function fmtMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60 * 10) / 10} h`;
  return `${Math.round(min / 1440 * 10) / 10} días`;
}
