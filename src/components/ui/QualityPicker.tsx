// Permite al vendedor clasificar manualmente la calidad del lead (hot/warm/cold).
// Antes solo se podía ver el badge generado por la IA (qualify-lead edge function)
// pero no cambiarlo. Tomy reportó "Clasificar chats hot/warm/cold no deja".

import { useState, useRef, useEffect } from 'react';
import { supabase } from '../../services/supabase';

const OPTIONS: Array<{
  value: 'hot' | 'warm' | 'cold' | null;
  emoji: string;
  label: string;
  bg: string;
  text: string;
}> = [
  { value: 'hot',  emoji: '🔥',  label: 'Hot',  bg: 'bg-rose-100',  text: 'text-rose-700' },
  { value: 'warm', emoji: '🌤️', label: 'Warm', bg: 'bg-amber-100', text: 'text-amber-700' },
  { value: 'cold', emoji: '❄️',  label: 'Cold', bg: 'bg-sky-100',   text: 'text-sky-700' },
  { value: null,   emoji: '⚪',  label: 'Sin clasificar', bg: 'bg-gray-100', text: 'text-gray-700' },
];

interface Props {
  contactId: string;
  current: 'hot' | 'warm' | 'cold' | null;
  onChange: () => void;
}

export default function QualityPicker({ contactId, current, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, [open]);

  const select = async (value: 'hot' | 'warm' | 'cold' | null) => {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('contacts')
        .update({
          quality_label: value,
          qualified_at: value ? new Date().toISOString() : null,
          // Marca que fue clasificación manual (no IA) para que el qualify-lead
          // edge function no la sobreescriba después.
          quality_reason: value ? 'Clasificación manual del vendedor' : null,
        })
        .eq('id', contactId);
      if (error) throw error;
      onChange();
      setOpen(false);
    } catch (e) {
      alert('Error al clasificar: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const currentOpt = OPTIONS.find(o => o.value === current) ?? OPTIONS[3];

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        title="Clasificar este lead"
        className={`inline-flex items-center gap-1 rounded-full font-medium text-xs px-2 py-1 transition-all hover:ring-2 hover:ring-crimson/30 disabled:opacity-50 ${currentOpt.bg} ${currentOpt.text}`}
      >
        <span>{currentOpt.emoji}</span>
        <span>{currentOpt.label}</span>
        <span className="opacity-50 text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 left-0 bg-white border border-border rounded-lg shadow-lg py-1 min-w-[180px]">
          {OPTIONS.map(o => (
            <button
              key={String(o.value)}
              onClick={() => void select(o.value)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 text-sm ${current === o.value ? 'font-semibold' : ''}`}
            >
              <span className="text-base">{o.emoji}</span>
              <span className={o.text}>{o.label}</span>
              {current === o.value && <span className="ml-auto text-emerald-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
