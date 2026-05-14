// Modal para crear un contacto manualmente.
// Caso de uso principal: walk-in al local (alguien entra al local, vendedor lo carga).
// También sirve para referidos o leads de eventos.
//
// Reglas:
// - Vendedor: el contact se asigna automáticamente a él (no puede elegir otro).
// - Admin (Leti): puede dejarlo sin asignar o elegir vendedor.
// - Channel default 'walk-in', cambiable si vino de otro lado (referido = 'web', etc).
// - El trigger DB detecta duplicados por phone/email y marca duplicate_of automático.

import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import type { Channel } from '../types';

interface DBAgent { id: string; name: string; branch: string | null }

interface Props {
  isAdmin: boolean;
  currentAgentDbId: string | null;
  currentAgentBranch?: string;
  onClose: () => void;
  onCreated: () => void;
}

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'walk-in',  label: 'Entró al local' },
  { value: 'whatsapp', label: 'WhatsApp (manual)' },
  { value: 'email',    label: 'Email' },
  { value: 'web',      label: 'Referido / Otro' },
];

export default function CreateContactModal({ isAdmin, currentAgentDbId, currentAgentBranch, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<Channel>('walk-in');
  const [propertyTitle, setPropertyTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [assignTo, setAssignTo] = useState<string>(isAdmin ? '' : (currentAgentDbId ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<{ id: string; name: string | null } | null>(null);
  const [agents, setAgents] = useState<DBAgent[]>([]);

  // Cargar agents reales desde DB para que el select use UUIDs verdaderos
  useEffect(() => {
    if (!isAdmin) return;
    void supabase
      .from('agents')
      .select('id, name, branch')
      .eq('active', true)
      .eq('role', 'agent')
      .order('name')
      .then(({ data }) => setAgents((data ?? []) as DBAgent[]));
  }, [isAdmin]);

  const normalizePhone = (p: string) => p.replace(/\D/g, '');

  const checkDuplicate = async (): Promise<{ id: string; name: string | null } | null> => {
    const phoneNorm = normalizePhone(phone);
    const emailNorm = email.trim().toLowerCase();
    if (!phoneNorm && !emailNorm) return null;
    // Hacemos 2 queries (no OR porque phone está sin normalizar en DB)
    const q = supabase.from('contacts').select('id, name, phone, email').limit(20);
    const [{ data: byEmail }, { data: byPhone }] = await Promise.all([
      emailNorm ? q.eq('email', emailNorm) : Promise.resolve({ data: [] as { id: string; name: string | null; phone: string | null; email: string | null }[] }),
      phoneNorm ? supabase.from('contacts').select('id, name, phone, email').not('phone', 'is', null).limit(50) : Promise.resolve({ data: [] as { id: string; name: string | null; phone: string | null; email: string | null }[] }),
    ]);
    const emailMatch = byEmail?.[0];
    const phoneMatch = (byPhone ?? []).find(c => c.phone && normalizePhone(c.phone) === phoneNorm);
    const hit = emailMatch ?? phoneMatch;
    return hit ? { id: hit.id, name: hit.name } : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDuplicateInfo(null);

    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) { setError('El nombre es obligatorio'); return; }
    if (!cleanPhone && !cleanEmail) {
      setError('Necesitamos al menos teléfono o email para contactar después');
      return;
    }

    setSaving(true);
    try {
      // Pre-check duplicate (UX > trigger DB que se ejecuta post-insert)
      const dup = await checkDuplicate();
      if (dup) {
        setDuplicateInfo(dup);
        setSaving(false);
        return;
      }

      const finalAssignedTo = isAdmin ? (assignTo || null) : currentAgentDbId;
      // El branch heredado del vendedor asignado (si lo hay) — sino el del agent actual
      const assignedAgent = finalAssignedTo ? agents.find(a => a.id === finalAssignedTo) : null;
      const finalBranch = assignedAgent?.branch ?? currentAgentBranch ?? 'Corrientes';

      const { error: insertErr } = await supabase.from('contacts').insert({
        name: cleanName,
        phone: cleanPhone || null,
        email: cleanEmail || null,
        channel,
        channel_id: null,
        status: 'new',
        current_stage_key: 'nuevo',
        assigned_to: finalAssignedTo,
        property_title: propertyTitle.trim() || null,
        notes: notes.trim() || null,
        branch: finalBranch,
      });

      if (insertErr) {
        // Si la policy bloquea (vendedor intentó asignar a otro), mostrar mensaje claro
        if (insertErr.message.toLowerCase().includes('policy')) {
          setError('No tenés permiso para asignar este contacto a otro vendedor. Pedí a Leti que lo reasigne.');
        } else if (insertErr.code === '23505') {
          setError('Ya existe un contacto con esos datos en este canal.');
        } else {
          setError(insertErr.message);
        }
        setSaving(false);
        return;
      }

      onCreated();
      onClose();
    } catch (ex) {
      const m = ex instanceof Error ? ex.message : String(ex);
      setError(m);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 safe-top safe-bottom" onClick={onClose}>
      <div
        className="bg-bg-card border border-border rounded-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-white font-semibold">Nuevo contacto</h2>
          <button onClick={onClose} className="text-muted hover:text-white text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-muted mb-1.5">Nombre completo <span className="text-crimson">*</span></label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              className="w-full bg-bg-input border border-border rounded-xl px-4 py-2.5 text-[#0F172A] text-base outline-none focus:border-crimson"
              placeholder="Juan Pérez"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1.5">Teléfono</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                inputMode="tel"
                className="w-full bg-bg-input border border-border rounded-xl px-4 py-2.5 text-[#0F172A] text-base outline-none focus:border-crimson"
                placeholder="+54 9 223 555-0001"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                inputMode="email"
                autoCapitalize="off"
                className="w-full bg-bg-input border border-border rounded-xl px-4 py-2.5 text-[#0F172A] text-base outline-none focus:border-crimson"
                placeholder="juan@gmail.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">¿Cómo llegó?</label>
            <select
              value={channel}
              onChange={e => setChannel(e.target.value as Channel)}
              className="w-full bg-bg-input border border-border rounded-xl px-3 py-2.5 text-[#0F172A] text-base outline-none focus:border-crimson"
            >
              {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">Propiedad de interés (opcional)</label>
            <input
              type="text"
              value={propertyTitle}
              onChange={e => setPropertyTitle(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-xl px-4 py-2.5 text-[#0F172A] text-base outline-none focus:border-crimson"
              placeholder="Ej: 2 amb Plaza Mitre, depto Alem..."
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">Notas (opcional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-bg-input border border-border rounded-xl px-4 py-2.5 text-[#0F172A] text-base outline-none focus:border-crimson resize-none"
              placeholder="Ej: Vino al local, busca depto para inversión USD 80K, le pasé Brown 2500"
            />
          </div>

          {isAdmin && (
            <div>
              <label className="block text-xs text-muted mb-1.5">Asignar a</label>
              <select
                value={assignTo}
                onChange={e => setAssignTo(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-xl px-3 py-2.5 text-[#0F172A] text-base outline-none focus:border-crimson"
              >
                <option value="">Sin asignar (lo asigno después)</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}{a.branch ? ` · ${a.branch}` : ''}</option>
                ))}
              </select>
            </div>
          )}

          {!isAdmin && (
            <div className="bg-bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-muted">
              Se asigna automáticamente a vos
            </div>
          )}

          {duplicateInfo && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-sm text-yellow-900">
              <div className="font-medium mb-1">Posible duplicado</div>
              <div>Ya existe un contacto <b>{duplicateInfo.name ?? 'sin nombre'}</b> con esos datos.</div>
              <button
                type="button"
                onClick={() => { setDuplicateInfo(null); /* TODO: open existing contact */ }}
                className="mt-2 underline text-yellow-700 hover:text-yellow-900"
              >
                Crear igual (forzar)
              </button>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-bg-input border border-border rounded-xl text-sm text-white hover:bg-bg-hover"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-crimson hover:bg-crimson-light text-white font-semibold rounded-xl disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Crear contacto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
