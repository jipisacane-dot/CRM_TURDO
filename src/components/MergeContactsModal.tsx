// Modal para unificar dos contactos que son la misma persona física.
// Útil cuando IG/FB no traen phone y crean un contact aparte del WhatsApp del mismo cliente.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';

interface ContactPreview {
  id: string;
  name: string | null;
  channel: string;
  phone: string | null;
  email: string | null;
  assigned_to: string | null;
  created_at: string;
  msg_count?: number;
}

interface AgentLite { id: string; name: string }

interface Props {
  currentLeadId: string;
  currentLeadName: string;
  onClose: () => void;
  onMerged: () => void; // refrescar leads después
}

export default function MergeContactsModal({ currentLeadId, currentLeadName, onClose, onMerged }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactPreview[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ContactPreview | null>(null);
  const [currentLead, setCurrentLead] = useState<ContactPreview | null>(null);
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [primaryId, setPrimaryId] = useState<string>(currentLeadId);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar info del lead actual + lista de agents (para mostrar nombres)
  useEffect(() => {
    void (async () => {
      const { data: lead } = await supabase
        .from('contacts')
        .select('id, name, channel, phone, email, assigned_to, created_at')
        .eq('id', currentLeadId)
        .maybeSingle();
      if (lead) setCurrentLead(lead as ContactPreview);
      const { data: ags } = await supabase.from('agents').select('id, name');
      setAgents(((ags ?? []) as AgentLite[]));
    })();
  }, [currentLeadId]);

  // Buscar contactos (debounce 300ms)
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const q = query.trim();
        // Buscar por nombre, phone o phone_normalized
        const phoneDigits = q.replace(/\D/g, '');
        let req = supabase
          .from('contacts')
          .select('id, name, channel, phone, email, assigned_to, created_at')
          .neq('id', currentLeadId)
          .limit(15);
        if (phoneDigits.length >= 4) {
          req = req.or(`name.ilike.%${q}%,phone.ilike.%${phoneDigits}%`);
        } else {
          req = req.ilike('name', `%${q}%`);
        }
        const { data } = await req;
        setResults((data ?? []) as ContactPreview[]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, currentLeadId]);

  const agentName = (id: string | null) => {
    if (!id) return '(sin asignar)';
    return agents.find(a => a.id === id)?.name ?? id.slice(0, 8);
  };

  const handleMerge = async () => {
    if (!selected || !currentLead) return;
    setMerging(true);
    setError(null);
    try {
      const duplicateId = primaryId === currentLeadId ? selected.id : currentLeadId;
      const { data, error: rpcErr } = await supabase.rpc('merge_contacts', {
        p_primary_id: primaryId,
        p_duplicate_id: duplicateId,
      });
      if (rpcErr) throw rpcErr;
      const result = data as { ok: boolean; error?: string; messages_moved?: number };
      if (!result.ok) {
        setError(result.error ?? 'Error desconocido');
        setMerging(false);
        return;
      }
      onMerged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setMerging(false);
    }
  };

  const channelIcon = (ch: string) => {
    if (ch === 'whatsapp') return '💚';
    if (ch === 'instagram') return '📷';
    if (ch === 'facebook') return '👥';
    if (ch === 'email') return '✉️';
    return '🔗';
  };

  const primaryContact = useMemo(() => {
    if (!selected || !currentLead) return null;
    return primaryId === currentLeadId ? currentLead : selected;
  }, [primaryId, currentLeadId, currentLead, selected]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-[#0F172A]">Unificar contactos</h2>
          <p className="text-sm text-muted mt-1">
            Buscá el otro contacto que sea la misma persona que <b>{currentLeadName || 'este lead'}</b>. Se unifican mensajes y se conserva un solo vendedor.
          </p>
        </div>

        <div className="p-6 space-y-5">
          {/* Buscador */}
          <div>
            <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Buscar el otro contacto</label>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
              placeholder="Nombre o teléfono…"
              className="w-full bg-white border border-border rounded-lg px-4 py-2.5 text-[#0F172A] outline-none focus:border-crimson"
            />
          </div>

          {/* Resultados */}
          {!selected && query.length >= 2 && (
            <div className="border border-border rounded-lg max-h-64 overflow-y-auto">
              {searching && <div className="p-3 text-sm text-muted">Buscando…</div>}
              {!searching && results.length === 0 && (
                <div className="p-3 text-sm text-muted">Sin resultados</div>
              )}
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="w-full text-left p-3 hover:bg-bg-soft transition-colors border-b border-border last:border-b-0 flex items-center gap-3"
                >
                  <span className="text-xl">{channelIcon(r.channel)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#0F172A] truncate">{r.name || 'Sin nombre'}</div>
                    <div className="text-xs text-muted truncate">
                      {r.phone || r.email || `${r.channel} · ${agentName(r.assigned_to)}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Preview del merge */}
          {selected && currentLead && (
            <div className="space-y-4">
              <div className="text-sm font-medium text-[#0F172A]">Elegí qué vendedor se queda con el lead unificado:</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[currentLead, selected].map(c => {
                  const isPrimary = primaryId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setPrimaryId(c.id)}
                      className={`text-left p-4 rounded-xl border-2 transition-all ${
                        isPrimary ? 'border-crimson bg-crimson/5' : 'border-border hover:border-border-strong'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">{channelIcon(c.channel)}</span>
                        <span className="font-medium text-[#0F172A]">{c.name || 'Sin nombre'}</span>
                        {isPrimary && <span className="ml-auto text-[10px] uppercase tracking-wider text-crimson font-semibold">PRIMARY</span>}
                      </div>
                      <div className="text-xs text-muted space-y-0.5">
                        <div>Canal: <b className="text-[#0F172A]">{c.channel}</b></div>
                        {c.phone && <div>Tel: <b className="text-[#0F172A]">{c.phone}</b></div>}
                        <div>Vendedor: <b className="text-[#0F172A]">{agentName(c.assigned_to)}</b></div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="bg-bg-soft border border-border rounded-lg p-4 text-sm text-ink-2">
                <div className="font-medium text-[#0F172A] mb-1">Resumen:</div>
                <ul className="space-y-1 text-xs">
                  <li>• Todos los mensajes de <b>{(primaryId === currentLeadId ? selected.name : currentLead.name) || 'Sin nombre'}</b> se moverán al chat de <b>{primaryContact?.name || 'Sin nombre'}</b>.</li>
                  <li>• El vendedor asignado quedará: <b>{agentName(primaryContact?.assigned_to ?? null)}</b>.</li>
                  <li>• El contacto duplicado se borra.</li>
                  <li>• Esta acción no se puede deshacer.</li>
                </ul>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border bg-bg-soft flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={merging}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-white"
          >
            Cancelar
          </button>
          <button
            onClick={handleMerge}
            disabled={!selected || merging}
            className="px-4 py-2 text-sm rounded-lg bg-crimson text-white font-medium hover:bg-crimson-light disabled:opacity-50"
          >
            {merging ? 'Unificando…' : 'Unificar'}
          </button>
        </div>
      </div>
    </div>
  );
}
