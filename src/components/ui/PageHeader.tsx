import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

// Header consistente para todas las páginas: h1 + subtítulo + acciones a la derecha.
// En mobile: h1 arriba, acciones abajo. En desktop: en una sola fila.
export default function PageHeader({ title, subtitle, badge, actions, className = '' }: Props) {
  return (
    <div className={`flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4 md:mb-5 ${className}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl md:text-2xl font-bold text-[#0F172A] leading-tight">{title}</h1>
          {badge}
        </div>
        {subtitle && (
          <p className="text-sm text-muted mt-1 leading-relaxed">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
