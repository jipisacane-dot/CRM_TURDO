import type { LeadStatus } from '../../types';

const cfg: Record<LeadStatus, { label: string; color: string; bg: string }> = {
  new:       { label: 'Nuevo',       color: '#60A5FA', bg: '#60A5FA15' },
  contacted: { label: 'Contactado',  color: '#A78BFA', bg: '#A78BFA15' },
  qualified: { label: 'Calificado',  color: '#F59E0B', bg: '#F59E0B15' },
  proposal:  { label: 'Propuesta',   color: '#F97316', bg: '#F9731615' },
  visit:     { label: 'Visita',      color: '#06B6D4', bg: '#06B6D415' },
  won:       { label: 'Cerrado ✓',   color: '#22C55E', bg: '#22C55E15' },
  lost:      { label: 'Perdido',     color: '#EF4444', bg: '#EF444415' },
};

export const StatusBadge = ({ status }: { status: LeadStatus }) => {
  const s = cfg[status];
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  );
};

export const statusConfig = cfg;
