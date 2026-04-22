import { useState } from 'react';
import { Modal } from './Modal';
import { useApp } from '../../contexts/AppContext';
import type { Lead } from '../../types';

const QUICK_OPTIONS = [
  { label: 'Mañana',    days: 1 },
  { label: '2 días',   days: 2 },
  { label: '3 días',   days: 3 },
  { label: '1 semana', days: 7 },
  { label: '2 semanas', days: 14 },
  { label: '1 mes',    days: 30 },
];

interface Props {
  open: boolean;
  onClose: () => void;
  lead: Lead;
}

export const ReminderModal = ({ open, onClose, lead }: Props) => {
  const { createReminder } = useApp();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [selectedDays, setSelectedDays] = useState<number | null>(null);
  const [customDate, setCustomDate] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle('');
    setNote('');
    setSelectedDays(null);
    setCustomDate('');
  };

  const handleClose = () => { reset(); onClose(); };

  const getDueAt = (): string | null => {
    if (selectedDays !== null) {
      const d = new Date();
      d.setDate(d.getDate() + selectedDays);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
    if (customDate) return new Date(customDate).toISOString();
    return null;
  };

  const handleSave = async () => {
    const dueAt = getDueAt();
    if (!title.trim() || !dueAt) return;
    setSaving(true);
    try {
      await createReminder(lead.id, title.trim(), dueAt, note.trim() || undefined);
      handleClose();
    } finally {
      setSaving(false);
    }
  };

  const dueAt = getDueAt();
  const dueLabel = dueAt
    ? new Date(dueAt).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    : null;

  return (
    <Modal open={open} onClose={handleClose} title="Crear recordatorio">
      <div className="space-y-4">
        {/* Contact info */}
        <div className="flex items-center gap-2 bg-bg-input rounded-xl px-3 py-2">
          <span className="text-lg">👤</span>
          <span className="text-sm text-gray-700 font-medium">{lead.name}</span>
          {lead.propertyTitle && (
            <span className="text-xs text-muted truncate">· {lead.propertyTitle}</span>
          )}
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">¿Qué hacer?</label>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Ej: Llamar cuando entre propiedad nueva en Palermo"
            className="w-full bg-bg-input border border-border rounded-xl px-3 py-2.5 text-sm text-gray-900 placeholder-muted outline-none focus:border-crimson"
          />
        </div>

        {/* Quick date selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">¿Cuándo recordar?</label>
          <div className="grid grid-cols-3 gap-2">
            {QUICK_OPTIONS.map(opt => (
              <button
                key={opt.days}
                onClick={() => { setSelectedDays(opt.days); setCustomDate(''); }}
                className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                  selectedDays === opt.days
                    ? 'bg-crimson text-white border-crimson'
                    : 'bg-bg-input border-border text-gray-700 hover:border-crimson'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="mt-2">
            <input
              type="date"
              value={customDate}
              onChange={e => { setCustomDate(e.target.value); setSelectedDays(null); }}
              min={new Date().toISOString().split('T')[0]}
              className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:border-crimson"
            />
          </div>
        </div>

        {/* Note */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nota (opcional)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Detalles adicionales..."
            rows={2}
            className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-muted outline-none focus:border-crimson resize-none"
          />
        </div>

        {/* Summary */}
        {dueLabel && title.trim() && (
          <div className="bg-crimson/5 border border-crimson/20 rounded-xl px-3 py-2.5 text-sm text-gray-700">
            🔔 Se te recordará el <strong>{dueLabel}</strong> sobre <strong>{lead.name}</strong>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleClose}
            className="flex-1 py-2.5 rounded-xl border border-border text-sm text-gray-600 hover:bg-bg-hover transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || !dueAt || saving}
            className="flex-1 py-2.5 rounded-xl bg-crimson text-white text-sm font-medium hover:bg-crimson-light transition-all disabled:opacity-40"
          >
            {saving ? 'Guardando...' : 'Crear recordatorio'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
