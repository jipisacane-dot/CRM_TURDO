import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import {
  scriptQueue as svc,
  STATUS_LABELS,
  STATUS_COLORS,
} from '../services/scriptQueue';
import type { ScriptQueueItem, ScriptStatus } from '../services/scriptQueue';

export default function ScriptQueue() {
  const { currentUser } = useApp();
  const [items, setItems] = useState<ScriptQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<ScriptStatus | 'all'>('all');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await svc.list());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch();
    const t = setInterval(() => void fetch(), 8000);
    return () => clearInterval(t);
  }, [fetch]);

  const submit = async () => {
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      await svc.create({
        url: url.trim(),
        note: note.trim() || undefined,
        requested_by: currentUser.dbId,
        requested_by_name: currentUser.name,
      });
      setUrl('');
      setNote('');
      await fetch();
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = filter === 'all' ? items : items.filter((i) => i.status === filter);
  const counts = {
    pending: items.filter((i) => i.status === 'pending' || i.status === 'notified' || i.status === 'in_progress').length,
    completed: items.filter((i) => i.status === 'completed').length,
  };

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">🎬 Cola de guiones</h1>
        <p className="text-muted text-sm mt-0.5">
          Pega un link de propiedad y Nacho recibe el aviso en Telegram. Su respuesta vuelve acá automáticamente.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Pendientes" value={counts.pending} color="text-yellow-600" />
        <StatCard label="Completados" value={counts.completed} color="text-green-600" />
        <StatCard label="Total" value={items.length} />
      </div>

      {/* Form */}
      <div className="bg-white border border-border rounded-2xl p-5 space-y-3">
        <div>
          <label className="block text-xs text-muted mb-1">URL de la propiedad *</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.tokkobroker.com/property/... o cualquier link"
            className="w-full bg-bg-input border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-crimson"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Nota (opcional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej: este me interesa para reel de Playa Grande / depto para captar / urgente"
            rows={2}
            className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-crimson resize-none"
          />
        </div>
        <div className="flex justify-end">
          <button
            onClick={submit}
            disabled={!url.trim() || submitting}
            className="px-4 py-2 bg-crimson text-white text-sm font-medium rounded-xl hover:bg-crimson-bright disabled:opacity-50"
          >
            {submitting ? 'Enviando…' : '📤 Enviar a Nacho'}
          </button>
        </div>
      </div>

      {/* Filtro */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'pending', 'notified', 'in_progress', 'completed'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s as ScriptStatus | 'all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === s ? 'bg-crimson text-white' : 'bg-bg-input text-gray-700 hover:bg-bg-hover'
            }`}
          >
            {s === 'all' ? 'Todos' : STATUS_LABELS[s as ScriptStatus]}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center text-muted py-12 text-sm">Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-border rounded-2xl p-12 text-center">
          <div className="text-5xl mb-3 opacity-20">📭</div>
          <p className="text-muted text-sm">
            {items.length === 0 ? 'Todavía no hay guiones pedidos.' : 'No hay guiones con este filtro.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <Card key={item.id} item={item} onChanged={() => void fetch()} />
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ item, onChanged }: { item: ScriptQueueItem; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const cancel = async () => {
    if (!confirm('¿Cancelar este pedido?')) return;
    await svc.cancel(item.id);
    onChanged();
  };
  const remove = async () => {
    if (!confirm('¿Eliminar este pedido?')) return;
    await svc.remove(item.id);
    onChanged();
  };

  return (
    <div className="bg-white border border-border rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono bg-bg-input px-2 py-0.5 rounded">{item.tracking_code}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${STATUS_COLORS[item.status]}`}>
              {STATUS_LABELS[item.status]}
            </span>
            <span className="text-[11px] text-muted">{new Date(item.created_at).toLocaleString('es-AR')}</span>
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-crimson-bright hover:underline truncate block mt-1.5"
          >
            {item.url}
          </a>
          {item.note && <p className="text-xs text-gray-700 mt-1">💬 {item.note}</p>}
        </div>
        <div className="flex gap-1.5">
          {item.status !== 'completed' && item.status !== 'cancelled' && (
            <button onClick={cancel} className="text-xs px-2 py-1 bg-bg-input hover:bg-bg-hover rounded-lg text-gray-600">
              Cancelar
            </button>
          )}
          <button onClick={remove} className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 rounded-lg text-red-600">
            🗑
          </button>
        </div>
      </div>

      {(item.ai_summary || item.jipi_response) && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-muted hover:text-gray-700 mt-2"
        >
          {expanded ? '▲ Ocultar' : '▼ Ver detalle'}
        </button>
      )}

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-3">
          {item.ai_summary && (
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">📊 Resumen IA</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap bg-bg-input rounded-lg p-3">{item.ai_summary}</div>
            </div>
          )}
          {item.jipi_response && (
            <div>
              <div className="text-xs font-semibold text-green-700 mb-1">🎬 Guion de Nacho</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap bg-green-50 border border-green-100 rounded-lg p-3">
                {item.jipi_response}
              </div>
              {item.completed_at && (
                <div className="text-[10px] text-muted mt-1">Recibido {new Date(item.completed_at).toLocaleString('es-AR')}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const StatCard = ({ label, value, color = 'text-[#0F172A]' }: { label: string; value: number; color?: string }) => (
  <div className="bg-white border border-border rounded-2xl p-4">
    <div className="text-muted text-[11px] uppercase tracking-wider">{label}</div>
    <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
  </div>
);
