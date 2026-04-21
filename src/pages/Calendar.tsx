import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isSameMonth, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { Modal } from '../components/ui/Modal';
import { AGENTS } from '../data/mock';

type EventType = 'post' | 'story' | 'reel' | 'visit' | 'reunion';
type Channel = 'instagram' | 'facebook' | 'ambos';
type Status = 'planned' | 'done' | 'cancelled';

interface CalEvent {
  id: string;
  date: string;
  type: EventType;
  title: string;
  channel?: Channel;
  agentId?: string;
  status: Status;
  notes?: string;
  time?: string;
}

const TYPE_COLOR: Record<EventType, string> = {
  post:    'bg-blue-500/80',
  story:   'bg-purple-500/80',
  reel:    'bg-pink-500/80',
  visit:   'bg-green-600/80',
  reunion: 'bg-amber-500/80',
};

const TYPE_LABEL: Record<EventType, string> = {
  post:    'Post',
  story:   'Story',
  reel:    'Reel',
  visit:   'Visita',
  reunion: 'Reunión',
};

const STORAGE_KEY = 'crm_calendar_events';

const loadEvents = (): CalEvent[] => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
};

const saveEvents = (events: CalEvent[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
};

const blank = (date: Date): Omit<CalEvent, 'id'> => ({
  date: format(date, 'yyyy-MM-dd'),
  type: 'post',
  title: '',
  channel: 'instagram',
  status: 'planned',
  notes: '',
  time: '',
  agentId: '',
});

export default function Calendar() {
  const [current, setCurrent] = useState(new Date());
  const [events, setEvents] = useState<CalEvent[]>(loadEvents);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [form, setForm] = useState<Omit<CalEvent, 'id'>>(blank(new Date()));
  const [tab, setTab] = useState<'content' | 'visits'>('content');

  useEffect(() => { saveEvents(events); }, [events]);

  const days = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) });
  const startPad = getDay(startOfMonth(current));

  const eventsForDay = (day: Date) =>
    events.filter(e => isSameDay(new Date(e.date + 'T12:00:00'), day) &&
      (tab === 'content' ? ['post','story','reel'].includes(e.type) : ['visit','reunion'].includes(e.type))
    );

  const openAdd = (day: Date) => {
    setEditing(null);
    setForm({ ...blank(day), type: tab === 'content' ? 'post' : 'visit' });
    setModal(true);
  };

  const openEdit = (ev: CalEvent) => {
    setEditing(ev);
    setForm({ date: ev.date, type: ev.type, title: ev.title, channel: ev.channel, agentId: ev.agentId, status: ev.status, notes: ev.notes, time: ev.time });
    setModal(true);
  };

  const handleSave = () => {
    if (!form.title.trim()) return;
    if (editing) {
      setEvents(prev => prev.map(e => e.id === editing.id ? { ...form, id: editing.id } : e));
    } else {
      setEvents(prev => [...prev, { ...form, id: crypto.randomUUID() }]);
    }
    setModal(false);
  };

  const handleDelete = () => {
    if (editing) setEvents(prev => prev.filter(e => e.id !== editing.id));
    setModal(false);
  };

  const monthEvents = events.filter(e => {
    const d = new Date(e.date + 'T12:00:00');
    return isSameMonth(d, current) &&
      (tab === 'content' ? ['post','story','reel'].includes(e.type) : ['visit','reunion'].includes(e.type));
  });

  const done = monthEvents.filter(e => e.status === 'done').length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Calendario</h1>
          <p className="text-muted text-sm mt-0.5">{monthEvents.length} eventos · {done} completados</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-bg-input border border-border rounded-xl overflow-hidden">
            <button onClick={() => setTab('content')} className={`px-4 py-2 text-sm font-medium transition-all ${tab === 'content' ? 'bg-crimson text-white' : 'text-muted hover:text-white'}`}>
              Contenido
            </button>
            <button onClick={() => setTab('visits')} className={`px-4 py-2 text-sm font-medium transition-all ${tab === 'visits' ? 'bg-crimson text-white' : 'text-muted hover:text-white'}`}>
              Visitas
            </button>
          </div>
        </div>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setCurrent(subMonths(current, 1))} className="p-2 text-muted hover:text-white hover:bg-bg-hover rounded-lg transition-all">◀</button>
        <h2 className="text-white font-semibold text-lg capitalize">
          {format(current, 'MMMM yyyy', { locale: es })}
        </h2>
        <button onClick={() => setCurrent(addMonths(current, 1))} className="p-2 text-muted hover:text-white hover:bg-bg-hover rounded-lg transition-all">▶</button>
      </div>

      {/* Calendar grid */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d => (
            <div key={d} className="text-center text-muted text-xs font-medium py-2">{d}</div>
          ))}
        </div>

        {/* Days */}
        <div className="grid grid-cols-7">
          {Array.from({ length: startPad }).map((_, i) => (
            <div key={`pad-${i}`} className="h-24 border-b border-r border-border/50 bg-bg-main/30" />
          ))}
          {days.map(day => {
            const dayEvents = eventsForDay(day);
            const isToday = isSameDay(day, new Date());
            return (
              <div
                key={day.toISOString()}
                onClick={() => openAdd(day)}
                className="h-24 border-b border-r border-border/50 p-1.5 cursor-pointer hover:bg-bg-hover/50 transition-all group relative"
              >
                <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${isToday ? 'bg-crimson text-white' : 'text-muted group-hover:text-white'}`}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-0.5 overflow-hidden">
                  {dayEvents.slice(0, 3).map(ev => (
                    <div
                      key={ev.id}
                      onClick={e => { e.stopPropagation(); openEdit(ev); }}
                      className={`${TYPE_COLOR[ev.type]} text-white text-[10px] px-1.5 py-0.5 rounded truncate cursor-pointer ${ev.status === 'done' ? 'opacity-50 line-through' : ''}`}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="text-muted text-[10px] px-1">+{dayEvents.length - 3} más</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4">
        {(tab === 'content' ? (['post','story','reel'] as EventType[]) : (['visit','reunion'] as EventType[])).map(t => (
          <div key={t} className="flex items-center gap-1.5 text-xs text-muted">
            <div className={`w-2.5 h-2.5 rounded-full ${TYPE_COLOR[t]}`} />
            {TYPE_LABEL[t]}
          </div>
        ))}
      </div>

      {/* Event modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Editar evento' : 'Nuevo evento'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-muted text-xs mb-1 block">Tipo</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as EventType }))}
                className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-crimson"
              >
                {(tab === 'content'
                  ? [['post','Post'],['story','Story'],['reel','Reel']] as [string,string][]
                  : [['visit','Visita'],['reunion','Reunión']] as [string,string][]
                ).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-muted text-xs mb-1 block">Fecha</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-crimson"
              />
            </div>
          </div>

          <div>
            <label className="text-muted text-xs mb-1 block">Título *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder={tab === 'content' ? 'Ej: Post departamento Güemes' : 'Ej: Visita Dto. 3B'}
              className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-crimson"
            />
          </div>

          {tab === 'content' && (
            <div>
              <label className="text-muted text-xs mb-1 block">Canal</label>
              <select
                value={form.channel}
                onChange={e => setForm(f => ({ ...f, channel: e.target.value as Channel }))}
                className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-crimson"
              >
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="ambos">Ambos</option>
              </select>
            </div>
          )}

          {tab === 'visits' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-muted text-xs mb-1 block">Hora</label>
                <input
                  type="time"
                  value={form.time}
                  onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                  className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-crimson"
                />
              </div>
              <div>
                <label className="text-muted text-xs mb-1 block">Vendedor</label>
                <select
                  value={form.agentId}
                  onChange={e => setForm(f => ({ ...f, agentId: e.target.value }))}
                  className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-crimson"
                >
                  <option value="">Sin asignar</option>
                  {AGENTS.filter(a => a.role === 'agent').map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="text-muted text-xs mb-1 block">Estado</label>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as Status }))}
              className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-crimson"
            >
              <option value="planned">Planificado</option>
              <option value="done">Completado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>

          <div>
            <label className="text-muted text-xs mb-1 block">Notas</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-crimson resize-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            {editing && (
              <button onClick={handleDelete} className="px-4 py-2 text-sm bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded-xl transition-all">
                Eliminar
              </button>
            )}
            <button onClick={() => setModal(false)} className="ml-auto px-4 py-2 text-sm text-muted hover:text-white border border-border rounded-xl transition-all">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={!form.title.trim()} className="px-4 py-2 text-sm bg-crimson hover:bg-crimson-light text-white rounded-xl transition-all disabled:opacity-40">
              Guardar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
