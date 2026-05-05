import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}

export const Modal = ({ open, onClose, title, children, width = 'max-w-md' }: Props) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${width} bg-bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh]`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h3 className="font-semibold text-[#0F172A] text-lg">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-[#0F172A] transition-colors text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-md hover:bg-bg-hover">×</button>
        </div>
        <div className="px-6 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};
