import { useState } from 'react';
import { supabase } from '../services/supabase';
import type { Lead, Agent } from '../types';

interface Suggestion {
  tone: string;
  text: string;
}

interface Props {
  lead: Lead;
  agent: Agent;
  onPick: (text: string) => void;
}

const TONE_STYLES: Record<string, { color: string; emoji: string }> = {
  cálido: { color: 'border-rose-200 bg-rose-50/50', emoji: '💬' },
  directo: { color: 'border-blue-200 bg-blue-50/50', emoji: '⚡' },
  persuasivo: { color: 'border-violet-200 bg-violet-50/50', emoji: '🎯' },
};

export default function ReplySuggestions({ lead, agent, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lastIn = [...lead.messages].reverse().find(m => m.direction === 'in');

  const handleClick = async () => {
    if (!lastIn) {
      alert('No hay mensaje del cliente para responder.');
      return;
    }
    setOpen(true);
    setLoading(true);
    setError(null);
    setSuggestions([]);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('suggest-reply', {
        body: { contact_id: lead.id, agent_name: agent.name },
      });
      if (fnErr) throw fnErr;
      const list = (data?.suggestions ?? []) as Suggestion[];
      if (list.length === 0) {
        setError('No se pudieron generar sugerencias. Intentá de nuevo.');
      } else {
        setSuggestions(list);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const pick = (text: string) => {
    onPick(text);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title="Sugerir respuesta con IA"
        disabled={!lastIn}
        className="bg-bg-input border border-border hover:border-crimson text-muted hover:text-crimson px-3 py-3 rounded-xl text-sm transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ✨
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-[#0F172A] flex items-center gap-2">
                  <span>✨</span> Sugerencias de respuesta
                </div>
                <div className="text-xs text-muted">3 variantes con tonos distintos. Tocá una para insertarla en el chat.</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-[#0F172A] text-sm px-2">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && (
                <div className="py-8 text-center text-muted text-sm">
                  <div className="inline-block animate-pulse">Pensando…</div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                  {error}
                  <button onClick={handleClick} className="block mt-2 text-xs text-red-600 hover:underline">Reintentar</button>
                </div>
              )}

              {!loading && !error && suggestions.map((s, i) => {
                const style = TONE_STYLES[s.tone.toLowerCase()] ?? TONE_STYLES.cálido;
                return (
                  <button
                    key={i}
                    onClick={() => pick(s.text)}
                    className={`w-full text-left p-3 rounded-xl border transition-colors hover:border-crimson hover:shadow-sm ${style.color}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span>{style.emoji}</span>
                      <span className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider">{s.tone}</span>
                    </div>
                    <div className="text-sm text-[#0F172A] whitespace-pre-wrap">{s.text}</div>
                  </button>
                );
              })}
            </div>

            <div className="p-2 border-t border-border bg-bg-soft text-[10px] text-muted text-center">
              Las sugerencias son orientativas — siempre podés editarlas antes de mandar.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
