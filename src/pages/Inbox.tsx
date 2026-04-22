import { useState, useRef, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { AGENTS } from '../data/mock';
import { ChannelIcon, channelLabel } from '../components/ui/ChannelIcon';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import { ReminderModal } from '../components/ui/ReminderModal';
import type { Channel, Lead } from '../types';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';

function LeadAvatar({ lead, size = 'md' }: { lead: Lead; size?: 'sm' | 'md' }) {
  const [imgError, setImgError] = useState(false);
  const sz = size === 'sm' ? 'w-9 h-9 text-xs' : 'w-10 h-10 text-sm';
  if (lead.avatarUrl && !imgError) {
    return (
      <img
        src={lead.avatarUrl}
        alt={lead.name}
        onError={() => setImgError(true)}
        className={`${sz} rounded-full object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <div className={`${sz} bg-crimson/20 border border-crimson/30 rounded-full flex items-center justify-center font-semibold text-crimson flex-shrink-0`}>
      {lead.name.charAt(0).toUpperCase()}
    </div>
  );
}

const ALL_CHANNELS: (Channel | 'all')[] = ['all', 'whatsapp', 'instagram', 'facebook', 'email', 'web', 'zonaprop', 'argenprop'];

export default function Inbox() {
  const { leads, assignLead, sendMessage, loading, dueReminders, completeReminder } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<Channel | 'all'>('all');
  const [reply, setReply] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [search, setSearch] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const filtered = leads
    .filter(l => channelFilter === 'all' || l.channel === channelFilter)
    .filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()) || (l.propertyTitle ?? '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

  const selected = selectedId ? (leads.find(l => l.id === selectedId) ?? null) : null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.messages.length]);

  const handleSend = async () => {
    if (!reply.trim() || !selected) return;
    const text = reply.trim();
    setReply('');
    await sendMessage(selected.id, text);
  };

  const unreadInLead = (lead: Lead) => lead.messages.filter(m => !m.read && m.direction === 'in').length;

  const assignedAgent = selected?.assignedTo ? AGENTS.find(a => a.id === selected.assignedTo) : null;

  return (
    <div className="flex h-screen md:h-[calc(100vh)] overflow-hidden bg-bg-main">
      {/* Conversation list */}
      <div className={`flex flex-col w-full md:w-80 lg:w-96 border-r border-border bg-bg-card flex-shrink-0 ${selectedId ? 'hidden md:flex' : 'flex'}`}>
        {/* Due reminders banner */}
        {dueReminders.length > 0 && (
          <div className="border-b border-border">
            {dueReminders.map(r => {
              const lead = leads.find(l => l.id === r.contact_id);
              return (
                <div key={r.id} className="flex items-start gap-2 px-4 py-3 bg-amber-50 border-b border-amber-100 last:border-b-0">
                  <span className="text-amber-500 text-base mt-0.5 flex-shrink-0">🔔</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-amber-800">{r.title}</div>
                    {lead && (
                      <button
                        onClick={() => setSelectedId(lead.id)}
                        className="text-xs text-amber-600 hover:underline truncate"
                      >
                        {lead.name}
                      </button>
                    )}
                    {r.note && <div className="text-xs text-amber-600 mt-0.5">{r.note}</div>}
                  </div>
                  <button
                    onClick={() => completeReminder(r.id)}
                    className="text-amber-400 hover:text-amber-600 text-xs flex-shrink-0 mt-0.5 px-2 py-1 rounded-lg hover:bg-amber-100 transition-all"
                  >
                    ✓ Listo
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="p-4 border-b border-border space-y-3">
          <h2 className="text-gray-900 font-semibold text-lg">Bandeja</h2>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar contacto o propiedad..."
            className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-crimson"
          />
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {ALL_CHANNELS.map(ch => (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${channelFilter === ch ? 'bg-crimson text-white' : 'bg-bg-input text-muted hover:text-white'}`}
              >
                {ch === 'all' ? 'Todos' : channelLabel(ch as Channel)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="text-center text-muted py-12 text-sm animate-pulse">Cargando conversaciones...</div>}
          {!loading && filtered.length === 0 && (
            <div className="text-center text-muted py-12 text-sm">No hay conversaciones</div>
          )}
          {filtered.map(lead => {
            const unread = unreadInLead(lead);
            const last = lead.messages[lead.messages.length - 1];
            return (
              <div
                key={lead.id}
                onClick={() => { setSelectedId(lead.id); }}
                className={`flex gap-3 p-4 border-b border-border cursor-pointer transition-all hover:bg-bg-hover ${selectedId === lead.id ? 'bg-bg-hover border-l-2 border-l-crimson' : ''}`}
              >
                <div className="relative flex-shrink-0">
                  <LeadAvatar lead={lead} size="md" />
                  <div className="absolute -bottom-0.5 -right-0.5">
                    <ChannelIcon channel={lead.channel} size="sm" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-sm font-medium truncate ${unread > 0 ? 'text-white' : 'text-gray-300'}`}>{lead.name}</span>
                    <span className="text-muted text-[10px] flex-shrink-0">{formatDistanceToNow(new Date(lead.lastActivity), { locale: es, addSuffix: false })}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <ChannelIcon channel={lead.channel} size="sm" />
                    {lead.assignedTo ? (
                      <span className="text-muted text-xs truncate">{AGENTS.find(a => a.id === lead.assignedTo)?.name.split(' ')[0]}</span>
                    ) : (
                      <span className="text-crimson-bright text-xs">Sin asignar</span>
                    )}
                  </div>
                  {last && <div className={`text-xs truncate mt-0.5 ${unread > 0 ? 'text-gray-300' : 'text-muted'}`}>{last.direction === 'out' ? '↪ ' : ''}{last.content}</div>}
                </div>
                {unread > 0 && (
                  <span className="bg-crimson-bright text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 self-start mt-1">{unread}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat window */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg-card flex-shrink-0">
            <button onClick={() => setSelectedId(null)} className="md:hidden text-muted hover:text-white mr-1">←</button>
            <LeadAvatar lead={selected} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-white font-semibold truncate">{selected.name}</div>
              <div className="flex items-center gap-2 flex-wrap">
                <ChannelIcon channel={selected.channel} size="sm" showLabel />
                {selected.propertyTitle && <span className="text-muted text-xs truncate">{selected.propertyTitle}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <StatusBadge status={selected.status} />
              <button
                onClick={() => setShowReminder(true)}
                title="Crear recordatorio"
                className="text-lg hover:scale-110 transition-transform"
              >
                🔔
              </button>
              <button
                onClick={() => setShowAssign(true)}
                className="text-xs bg-bg-input hover:bg-bg-hover border border-border rounded-lg px-3 py-1.5 text-gray-700 transition-all"
              >
                {assignedAgent ? assignedAgent.name.split(' ')[0] : '+ Asignar'}
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {selected.messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                  msg.direction === 'out'
                    ? 'bg-crimson text-white rounded-br-md'
                    : 'bg-bg-card border border-border text-gray-200 rounded-bl-md'
                }`}>
                  {msg.direction === 'out' && msg.agentId && (
                    <div className="text-[10px] text-crimson-50/70 mb-1">
                      {AGENTS.find(a => a.id === msg.agentId)?.name.split(' ')[0]} ·
                    </div>
                  )}
                  <p className="leading-relaxed">{msg.content}</p>
                  <div className={`text-[10px] mt-1 ${msg.direction === 'out' ? 'text-white/50' : 'text-muted'}`}>
                    {format(new Date(msg.timestamp), 'HH:mm')}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply input */}
          <div className="border-t border-border p-4 bg-bg-card flex-shrink-0">
            <div className="flex gap-2 items-end">
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
                placeholder={`Responder por ${channelLabel(selected.channel)}...`}
                rows={2}
                className="flex-1 bg-bg-input border border-border rounded-xl px-4 py-3 text-sm text-white placeholder-muted outline-none focus:border-crimson resize-none"
              />
              <button
                onClick={handleSend}
                disabled={!reply.trim()}
                className="bg-crimson hover:bg-crimson-light text-white px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-40"
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-muted">
          <div className="text-center">
            <div className="text-4xl mb-3">💬</div>
            <p>Seleccioná una conversación</p>
          </div>
        </div>
      )}

      {/* Reminder modal */}
      {selected && (
        <ReminderModal
          open={showReminder}
          onClose={() => setShowReminder(false)}
          lead={selected}
        />
      )}

      {/* Assign modal */}
      <Modal open={showAssign} onClose={() => setShowAssign(false)} title="Asignar vendedor">
        <div className="space-y-2">
          {AGENTS.filter(a => a.role === 'agent').map(agent => (
            <button
              key={agent.id}
              onClick={() => { if (selected) assignLead(selected.id, agent.id); setShowAssign(false); }}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
                selected?.assignedTo === agent.id
                  ? 'border-crimson bg-crimson/10'
                  : 'border-border hover:bg-bg-hover'
              }`}
            >
              <Avatar initials={agent.avatar} size="sm" />
              <div className="text-left flex-1">
                <div className="text-white text-sm font-medium">{agent.name}</div>
                <div className="text-muted text-xs">{agent.branch} · {agent.stats.active} activos</div>
              </div>
              {selected?.assignedTo === agent.id && <span className="text-crimson-bright text-sm">✓</span>}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
