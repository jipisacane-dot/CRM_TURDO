import { useEffect, useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../services/supabase';

interface UIMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

// Lo que mandamos a la edge function como history (sin timestamp UI)
interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'turdo_assistant_chat_v1';
const MAX_HISTORY = 10; // últimos 10 mensajes (5 turnos) para mantener costo bajo

const SUGGESTIONS = [
  '¿Cómo viene el equipo este mes?',
  '¿Cuántos leads tenemos sin asignar?',
  '¿Cuál vendedor responde más rápido?',
  '¿Qué canal trae más leads?',
  '¿Cuánto vamos a facturar este mes?',
  '¿Hay leads sin responder hace más de 24hs?',
];

export default function AssistantChat() {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';

  const [messages, setMessages] = useState<UIMessage[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as UIMessage[];
    } catch {}
    return [];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persistir en localStorage
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch {}
  }, [messages]);

  // Auto-scroll al final
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || loading) return;
    setError(null);
    const newUserMsg: UIMessage = { role: 'user', content: text, ts: Date.now() };
    const updated = [...messages, newUserMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      // Tomar últimos N mensajes como history (excluyendo el que acabamos de agregar)
      const history: ApiMessage[] = messages.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }));
      const { data, error: invokeErr } = await supabase.functions.invoke('assistant-chat', {
        body: { history, question: text, role: currentUser.role },
      });
      if (invokeErr) throw new Error(invokeErr.message);
      if (data?.error) throw new Error(data.error);
      const answer = data?.answer ?? 'No pude responder, probá de nuevo.';
      setMessages([...updated, { role: 'assistant', content: answer, ts: Date.now() }]);
    } catch (e) {
      setError((e as Error).message);
      setMessages(updated); // mantenemos la pregunta del user, no la respuesta
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const clearChat = () => {
    if (!confirm('¿Borrar la conversación?')) return;
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void ask(input);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-5 md:p-8">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <p className="text-amber-900 font-medium">El Asistente IA es exclusivo para Leticia (admin) por ahora.</p>
          <p className="text-amber-700 text-sm mt-1">Próximamente vamos a habilitarlo también para vendedores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-[calc(100vh-2rem)] max-w-3xl mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-crimson to-crimson-bright flex items-center justify-center text-white font-bold text-lg">
            ✨
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[#0F172A]">Asistente IA</h1>
            <p className="text-muted text-xs">Preguntale cualquier cosa sobre el CRM</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button onClick={clearChat} className="text-xs text-muted hover:text-red-600 transition-colors">
            Borrar conversación
          </button>
        )}
      </div>

      {/* Banner fase de desarrollo */}
      {messages.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-4 text-xs text-amber-900">
          🚧 <strong>CRM en fase de desarrollo</strong> · Algunas métricas todavía están vacías. A medida que el equipo cargue ventas y negociaciones, las respuestas van a tener más contenido.
        </div>
      )}

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center pt-8">
            <div className="text-4xl mb-3">👋</div>
            <h2 className="text-base font-semibold text-[#0F172A] mb-1">¿En qué te ayudo, Leticia?</h2>
            <p className="text-muted text-xs mb-6">Probá con una de estas preguntas o escribí la tuya</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl mx-auto">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => void ask(s)}
                  className="text-left px-3 py-2.5 rounded-xl border border-border bg-white hover:bg-bg-hover transition-all text-sm text-[#0F172A]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} />
          ))
        )}
        {loading && (
          <div className="flex items-center gap-2 text-muted text-sm">
            <div className="w-7 h-7 rounded-full bg-crimson/10 flex items-center justify-center text-xs">✨</div>
            <span className="animate-pulse">Pensando…</span>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
            Error: {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="pt-3 border-t border-border">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
            placeholder="Preguntale al asistente…"
            rows={1}
            className="flex-1 bg-white border border-border rounded-xl px-3 py-2.5 text-sm text-[#0F172A] outline-none focus:border-crimson transition-colors resize-none"
            style={{ minHeight: '42px', maxHeight: '120px' }}
            autoFocus
          />
          <button
            onClick={() => void ask(input)}
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 bg-crimson text-white rounded-xl text-sm font-medium hover:bg-crimson-bright transition-all disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
        <p className="text-[10px] text-muted mt-2">
          Enter para enviar · Shift+Enter para salto de línea · Las respuestas usan datos reales del CRM
        </p>
      </div>
    </div>
  );
}

// Render de un mensaje con formato simple (negritas, bullets, links)
const Bubble = ({ role, content }: { role: 'user' | 'assistant'; content: string }) => {
  const isUser = role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-crimson to-crimson-bright flex items-center justify-center text-white text-xs flex-shrink-0">
          ✨
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-crimson text-white rounded-tr-sm'
            : 'bg-white border border-border text-[#0F172A] rounded-tl-sm'
        }`}
      >
        <FormattedText text={content} />
      </div>
    </div>
  );
};

// Render simple de **bold** y bullets
const FormattedText = ({ text }: { text: string }) => {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        // Bullets
        const isBullet = /^\s*[-•·]\s/.test(line);
        const content = isBullet ? line.replace(/^\s*[-•·]\s/, '') : line;
        // Reemplazar **bold**
        const parts = content.split(/(\*\*[^*]+\*\*)/g);
        const rendered = parts.map((p, j) =>
          /^\*\*[^*]+\*\*$/.test(p)
            ? <strong key={j}>{p.slice(2, -2)}</strong>
            : <span key={j}>{p}</span>
        );
        return (
          <div key={i} className={isBullet ? 'pl-4 relative before:content-["•"] before:absolute before:left-1' : ''}>
            {rendered}
          </div>
        );
      })}
    </>
  );
};
