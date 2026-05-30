import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  label: string;          // aria-label + title (accesibilidad / tooltip)
  active?: boolean;       // estado "encendido" (p. ej. portal ya generado)
  tone?: 'default' | 'success' | 'warning';
}

// Botón cuadrado de la barra de respuesta del chat. Unifica tamaño táctil (40px),
// radio, estados hover/active/disabled y color para los 6 disparadores de la barra
// (plantillas, sugerencias IA, portal, adjuntar, audio, reactivación). Antes cada
// uno repetía la misma clase larga con un emoji adentro.
export const ComposerIconButton = forwardRef<HTMLButtonElement, Props>(
  ({ icon: Icon, label, active = false, tone = 'default', className = '', ...rest }, ref) => {
    const toneClasses = active
      ? tone === 'success'
        ? 'border-emerald-400 text-emerald-600 bg-emerald-50'
        : 'border-crimson text-crimson bg-crimson-50'
      : tone === 'warning'
      ? 'border-amber-300 text-amber-600 bg-amber-50 hover:border-amber-400'
      : 'border-border text-muted bg-bg-input hover:border-crimson hover:text-crimson';

    return (
      <button
        ref={ref}
        type="button"
        title={label}
        aria-label={label}
        className={`flex items-center justify-center h-10 w-10 flex-shrink-0 rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toneClasses} ${className}`}
        {...rest}
      >
        <Icon size={19} strokeWidth={1.9} />
      </button>
    );
  }
);

ComposerIconButton.displayName = 'ComposerIconButton';
