import type { Lead } from '../../types';

const STYLES = {
  hot: { emoji: '🔥', label: 'Hot', bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500' },
  warm: { emoji: '🌤️', label: 'Warm', bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  cold: { emoji: '❄️', label: 'Cold', bg: 'bg-sky-100', text: 'text-sky-700', dot: 'bg-sky-500' },
};

interface Props {
  lead: Pick<Lead, 'quality_label' | 'quality_score' | 'quality_reason'>;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export default function QualityBadge({ lead, size = 'sm', showLabel = false }: Props) {
  const label = lead.quality_label;
  if (!label || !STYLES[label]) return null;
  const s = STYLES[label];

  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-xs px-2 py-1';

  return (
    <span
      title={`${s.label} · score ${lead.quality_score ?? '?'} — ${lead.quality_reason ?? ''}`}
      className={`inline-flex items-center gap-1 rounded-full font-medium ${s.bg} ${s.text} ${sizeClasses}`}
    >
      <span>{s.emoji}</span>
      {showLabel && <span>{s.label}</span>}
      {typeof lead.quality_score === 'number' && (
        <span className="tabular-nums opacity-70">{lead.quality_score}</span>
      )}
    </span>
  );
}

export function QualityFilter({
  selected, onSelect,
}: {
  selected: 'all' | 'hot' | 'warm' | 'cold' | 'unrated';
  onSelect: (v: 'all' | 'hot' | 'warm' | 'cold' | 'unrated') => void;
}) {
  const opts: Array<{ value: typeof selected; label: string; emoji: string }> = [
    { value: 'all', label: 'Todos', emoji: '·' },
    { value: 'hot', label: 'Hot', emoji: '🔥' },
    { value: 'warm', label: 'Warm', emoji: '🌤️' },
    { value: 'cold', label: 'Cold', emoji: '❄️' },
    { value: 'unrated', label: 'Sin calificar', emoji: '⚪' },
  ];
  return (
    <div className="flex gap-1 flex-wrap">
      {opts.map(o => (
        <button
          key={o.value}
          onClick={() => onSelect(o.value)}
          className={`text-xs px-2 py-1 rounded-full transition-colors ${selected === o.value ? 'bg-crimson text-white' : 'bg-bg-input text-muted hover:bg-bg-hover'}`}
        >
          {o.emoji} {o.label}
        </button>
      ))}
    </div>
  );
}
