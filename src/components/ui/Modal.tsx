import { useEffect, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}

// En desktop: modal centrado tradicional
// En mobile: bottom sheet que sube desde abajo (estilo nativo iOS/Android)
export const Modal = ({ open, onClose, title, children, width = 'max-w-md' }: Props) => {
  // Bloquear scroll del body cuando está abierto
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full ${width} bg-bg-card border border-border md:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92dvh] md:max-h-[90vh] md:m-auto sheet-up md:animate-none`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Drag handle visual en mobile (no funcional, solo decorativo) */}
        <div className="md:hidden flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 bg-slate-300 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 md:px-6 py-3 md:py-4 border-b border-border flex-shrink-0">
          <h3 className="font-semibold text-[#0F172A] text-base md:text-lg">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-muted hover:text-[#0F172A] transition-colors text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-md hover:bg-bg-hover"
          >
            ×
          </button>
        </div>
        <div className="px-5 md:px-6 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};
