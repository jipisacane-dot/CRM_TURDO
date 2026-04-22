import type { LeadStatus } from '../../types';

const cfg: Record<LeadStatus, { label: string; color: string; bg: string }> = {
  new:       { label: 'Nuevo',      color: '#1D4ED8', bg: '#EFF6FF' },
  contacted: { label: 'Contactado', color: '#6D28D9', bg: '#F5F3FF' },
  qualified: { label: 'Calificado', color: '#B45309', bg: '#FFFBEB' },
  proposal:  { label: 'Propuesta',  color: '#C2410C', bg: '#FFF7ED' },
  visit:     { label: 'Visita',     color: '#0E7490', bg: '#ECFEFF' },
  won:       { label: 'Cerrado',    color: '#166534', bg: '#F0FDF4' },
  lost:      { label: 'Perdido',    color: '#991B1B', bg: '#FEF2F2' },
};

export const StatusBadge = ({ status }: { status: LeadStatus }) => {
  const s = cfg[status];
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[11px] font-medium tracking-wide"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  );
};

export const statusConfig = cfg;
