import type { ReactNode } from 'react';

interface Props {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

// Estado vacío consistente para listas/secciones sin contenido.
export default function EmptyState({ icon = '📭', title, description, action, className = '' }: Props) {
  return (
    <div className={`bg-white border border-dashed border-border rounded-2xl py-10 px-4 text-center ${className}`}>
      <div className="text-5xl mb-3">{icon}</div>
      <h3 className="text-base font-semibold text-[#0F172A]">{title}</h3>
      {description && (
        <p className="text-sm text-muted mt-1 max-w-md mx-auto">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
