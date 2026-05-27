import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { InboxItem } from '../components/InboxItem';
import { useApp } from '../contexts/AppContext';
import { ChannelIcon, channelLabel } from '../components/ui/ChannelIcon';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import { ReminderModal } from '../components/ui/ReminderModal';
import TemplatePicker from '../components/TemplatePicker';
import ReplySuggestions from '../components/ReplySuggestions';
import ClientPortalButton from '../components/ClientPortalButton';
import AttachMediaButton from '../components/AttachMediaButton';
import RecordVoiceButton from '../components/RecordVoiceButton';
import TemplateReactivationPicker from '../components/TemplateReactivationPicker';
import MergeContactsModal from '../components/MergeContactsModal';
import { QualityFilter } from '../components/ui/QualityBadge';
import QualityPicker from '../components/ui/QualityPicker';
import MessageMedia from '../components/ui/MessageMedia';
import LinkifiedText from '../components/ui/LinkifiedText';
import { pipelineStagesApi, pipelineApi, type PipelineStage } from '../services/pipeline';
import { db } from '../services/supabase';
import type { Channel, Lead } from '../types';
import { format } from 'date-fns';

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
  const { leads, assignLead, sendMessage, loading, dueReminders, completeReminder, currentUser, dbAgents, refreshLeads, loadLeadMessages, markChatRead } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<Channel | 'all'>('all');
  const [qualityFilter, setQualityFilter] = useState<'all' | 'hot' | 'warm' | 'cold' | 'unrated'>('all');
  // Tomy reportó que chats perdidos/duplicados ensucian la bandeja. Por defecto los
  // escondemos. Un toggle permite mostrarlos cuando hace falta (auditoría, etc).
  const [showArchived, setShowArchived] = useState(false);
  const [reply, setReply] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [search, setSearch] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [changingStage, setChangingStage] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Editar teléfono del contacto (caso típico: lead con número mal cargado
  // del form de Meta, vendedor lo corrige tras pedirle bien al cliente).
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSavePhone = async () => {
    if (!selected) return;
    // Normalizar: solo dígitos y +
    const normalized = phoneInput.trim().replace(/[^\d+]/g, '');
    if (normalized && normalized.replace(/\D/g, '').length < 8) {
      alert('Número muy corto — revisalo. Ej: +5492235252984');
      return;
    }
    setSavingPhone(true);
    try {
      await db.contacts.update(selected.id, { phone: normalized || null });
      setEditingPhone(false);
      await refreshLeads();
    } catch (e) {
      alert('Error al guardar teléfono: ' + (e as Error).message);
    } finally {
      setSavingPhone(false);
    }
  };

  useEffect(() => {
    void pipelineStagesApi.list().then(setStages);
  }, []);

  // Detectar ?lead=X en la URL para auto-seleccionar (viene desde Pipeline)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const leadId = params.get('lead');
    if (leadId) setSelectedId(leadId);
  }, []);

  // Cuando se selecciona un lead, traer sus mensajes completos en query targeted.
  // Esto garantiza que el chat abierto tiene todos los mensajes aunque la tabla
  // global haya crecido > 1000 mensajes (límite duro de PostgREST).
  // También reseteamos el input + el error previo para que un texto que el vendor
  // estaba escribiendo en chat A no se vaya al chat B por accidente (bug Tomy:
  // "leads en frío no se envían y aparecen en el último chat que tenes").
  useEffect(() => {
    if (selectedId) {
      void loadLeadMessages(selectedId);
      setReply('');
      setSendError(null);
    }
  }, [selectedId, loadLeadMessages]);

  // Mark-as-read con delay: el chat se marca como leído sólo después de que
  // el vendor lo tuvo abierto por 1.5s. Esto evita que clicks rápidos pasando
  // por varios chats marquen todos como leídos sin que los haya leído de verdad
  // (bug Tomy: "mensajes siguen apareciendo como leídos").
  useEffect(() => {
    if (!selectedId) return;
    const t = window.setTimeout(() => { void markChatRead(selectedId); }, 1500);
    return () => window.clearTimeout(t);
  }, [selectedId, markChatRead]);

  const changeStage = async (newKey: string) => {
    if (!selected || changingStage) return;
    if (selected.current_stage_key === newKey) return;
    setChangingStage(true);
    try {
      await pipelineApi.changeStage(selected.id, newKey);
      await refreshLeads();
    } catch (e) {
      alert('Error al cambiar etapa: ' + (e as Error).message);
    } finally {
      setChangingStage(false);
    }
  };

  const isAdmin = currentUser.role === 'admin';
  // Vendedores filtran por currentUser.dbId (UUID real de DB), NO por currentUser.id (mock string del login).
  // Si dbId todavía no resolvió, lista vacía (evita mostrar leads de otros agentes brevemente).
  // Memoizado para evitar re-filtrado en cada render (1576 items × cada keystroke = lag).
  // Chats que ensucian la bandeja: ganados, perdidos, y duplicados (que ya
  // están representados por su original). Si showArchived=true los traemos
  // igual al final, ordenados por fecha.
  const isArchived = (l: Lead) =>
    l.current_stage_key === 'perdido' ||
    l.current_stage_key === 'ganado' ||
    !!l.duplicate_of;

  // El toggle de archivados es EXCLUSIVO (filtro): cuando está OFF muestra solo
  // activos, cuando está ON muestra solo archivados. NO los suma. Pedido Leti
  // 27/05: "cuando tocas archivados unicamente aparezcan los archivados".
  const filtered = useMemo(() => {
    const scope = isAdmin ? leads : leads.filter(l => currentUser.dbId && l.assignedTo === currentUser.dbId);
    const q = search.toLowerCase();
    return scope
      .filter(l => showArchived ? isArchived(l) : !isArchived(l))
      .filter(l => channelFilter === 'all' || l.channel === channelFilter)
      .filter(l => qualityFilter === 'all' ||
        (qualityFilter === 'unrated' ? !l.quality_label : l.quality_label === qualityFilter))
      .filter(l => !q || l.name.toLowerCase().includes(q) || (l.propertyTitle ?? '').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
  }, [leads, isAdmin, currentUser.dbId, channelFilter, qualityFilter, search, showArchived]);

  // Conteo total de archivados (independiente del filtro actual) para mostrar
  // en el badge del toggle. Se basa en el scope (admin ve todos, vendor solo
  // los suyos).
  const totalArchivedInScope = useMemo(() => {
    const scope = isAdmin ? leads : leads.filter(l => currentUser.dbId && l.assignedTo === currentUser.dbId);
    return scope.filter(isArchived).length;
  }, [leads, isAdmin, currentUser.dbId]);

  // Renderizado incremental con IntersectionObserver: empezamos con 30 items
  // (suficientes para llenar pantalla mobile), cargamos +30 cuando el sentinel
  // entra en vista. Mucho más eficiente que onScroll porque NO dispara en cada
  // pixel de scroll, solo cuando el sentinel cruza el viewport.
  const [visibleCount, setVisibleCount] = useState(30);
  useEffect(() => { setVisibleCount(30); }, [channelFilter, qualityFilter, search, showArchived]);
  const visibleLeads = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (visibleCount >= filtered.length) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount(c => Math.min(c + 30, filtered.length));
      }
    }, { rootMargin: '300px' });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [visibleCount, filtered.length]);

  // Callback memoizado para que React.memo en InboxItem funcione
  const handleSelectLead = useCallback((id: string) => setSelectedId(id), []);
  const unreadInLead = useCallback((lead: typeof leads[number]) =>
    lead.messages.filter(m => !m.read && m.direction === 'in').length, []);
  // Mapa agentId → name para resolución rápida (estable salvo que cambien dbAgents)
  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    dbAgents.forEach(a => m.set(a.id, a.name));
    return m;
  }, [dbAgents]);

  const selected = selectedId ? (leads.find(l => l.id === selectedId) ?? null) : null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.messages.length]);

  const handleSend = async () => {
    if (!reply.trim() || !selected || sending) return;
    const text = reply.trim();
    setReply('');
    setSendError(null);
    setSending(true);
    const result = await sendMessage(selected.id, text);
    setSending(false);
    if (!result.ok) {
      if (result.auth_error) {
        setSendError('⚠ Token de Meta vencido. Avisale al admin para renovar el token.');
      } else if (result.no_phone) {
        setSendError('Este contacto no tiene teléfono cargado. Editalo en el header del chat (click sobre "Sin teléfono") y cargá el número.');
      } else if (result.permission_error || result.outside_window) {
        // Tanto code 200 de Meta como "outside window" de ManyChat representan el
        // mismo problema estructural: no podemos enviar a este contacto desde el
        // CRM hasta que ManyChat registre una "interacción" real (click en botón
        // o quick reply de un flujo). Por ahora, solo se puede responder desde
        // la app de WhatsApp Business directamente.
        setSendError('No se puede responder a este contacto desde el CRM. Respondele desde WhatsApp Business directamente.');
      } else {
        setSendError('No se pudo enviar el mensaje. Revisá que el contacto esté activo en el canal.');
      }
    }
  };

  const assignedAgent = selected?.assignedTo ? dbAgents.find(a => a.id === selected.assignedTo) : null;

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ background: '#F8F9FB' }}
    >
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
          <div className="flex items-center gap-2">
            <div className="overflow-x-auto pb-1 scrollbar-hide flex-1">
              <QualityFilter selected={qualityFilter} onSelect={setQualityFilter} />
            </div>
            <button
              onClick={() => setShowArchived(s => !s)}
              title={showArchived ? 'Volver a la bandeja activa' : 'Ver solo perdidos, ganados y duplicados'}
              className={`text-[10px] px-2 py-1 rounded-full flex-shrink-0 transition-all ${showArchived ? 'bg-crimson text-white' : 'bg-bg-input text-muted hover:text-white'}`}
            >
              {showArchived ? `📁 Volver a activos` : `📁 Archivados (${totalArchivedInScope})`}
            </button>
          </div>
          {showArchived && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
              Mostrando solo archivados ({filtered.length}) — ganados, perdidos o duplicados.
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && <div className="text-center text-muted py-12 text-sm animate-pulse">Cargando conversaciones...</div>}
          {!loading && filtered.length === 0 && (
            <div className="text-center text-muted py-12 text-sm">No hay conversaciones</div>
          )}
          {visibleLeads.map(lead => (
            <InboxItem
              key={lead.id}
              lead={lead}
              isSelected={selectedId === lead.id}
              unread={unreadInLead(lead)}
              agentName={lead.assignedTo ? agentNameById.get(lead.assignedTo) : undefined}
              onSelect={handleSelectLead}
            />
          ))}
          {visibleCount < filtered.length && (
            <div ref={sentinelRef} className="text-center py-4 text-muted text-xs">
              Cargando más ({visibleCount}/{filtered.length})...
            </div>
          )}
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
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold truncate">{selected.name}</span>
                <QualityPicker
                  contactId={selected.id}
                  current={selected.quality_label ?? null}
                  onChange={() => { void refreshLeads(); }}
                />
                {selected.duplicate_of && (() => {
                  const original = leads.find(l => l.id === selected.duplicate_of);
                  return (
                    <button
                      onClick={() => original && setSelectedId(original.id)}
                      title={`Duplicado de ${original?.name ?? 'otro lead'} — click para abrir el original`}
                      className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full hover:bg-amber-200 flex-shrink-0"
                    >
                      ⚠ Duplicado de {original?.name ?? '...'}
                    </button>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <ChannelIcon channel={selected.channel} size="sm" showLabel />
                {editingPhone ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSavePhone();
                        if (e.key === 'Escape') setEditingPhone(false);
                      }}
                      placeholder="+5492235252984"
                      className="bg-bg-input border border-crimson rounded px-2 py-0.5 text-xs font-mono text-white w-44 outline-none"
                      disabled={savingPhone}
                    />
                    <button
                      onClick={() => void handleSavePhone()}
                      disabled={savingPhone}
                      className="text-xs text-emerald-400 hover:text-emerald-300 px-1.5 py-0.5 disabled:opacity-50"
                      title="Guardar"
                    >
                      {savingPhone ? '...' : '✓'}
                    </button>
                    <button
                      onClick={() => setEditingPhone(false)}
                      disabled={savingPhone}
                      className="text-xs text-muted hover:text-white px-1.5 py-0.5"
                      title="Cancelar"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setPhoneInput(selected.phone ?? ''); setEditingPhone(true); }}
                    className="text-muted text-xs font-mono hover:text-white transition-colors flex items-center gap-1 group"
                    title="Editar teléfono"
                  >
                    {selected.phone || <span className="italic">Sin teléfono</span>}
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px]">✏️</span>
                  </button>
                )}
                {selected.propertyTitle && <span className="text-muted text-xs truncate">{selected.propertyTitle}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              <div className="hidden md:block"><StatusBadge status={selected.status} /></div>
              <button
                onClick={() => setShowReminder(true)}
                title="Crear recordatorio"
                aria-label="Crear recordatorio"
                className="text-base sm:text-lg hover:scale-110 transition-transform p-1.5"
              >
                🔔
              </button>
              <button
                onClick={() => setShowAssign(true)}
                title={assignedAgent ? `Asignado a ${assignedAgent.name}` : 'Asignar a vendedor'}
                className="text-xs bg-bg-input hover:bg-bg-hover border border-border rounded-lg px-2 sm:px-3 py-1.5 text-gray-700 transition-all whitespace-nowrap max-w-[110px] truncate"
              >
                {assignedAgent ? assignedAgent.name.split(' ')[0] : '+ Asignar'}
              </button>
              {isAdmin && (
                <button
                  onClick={() => setShowMerge(true)}
                  title="Unificar con otro contacto"
                  aria-label="Unificar con otro contacto"
                  className="text-base sm:text-lg hover:scale-110 transition-transform p-1.5"
                >
                  🔗
                </button>
              )}
            </div>
          </div>

          {/* Selector de etapa pipeline */}
          {stages.length > 0 && (
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border bg-bg-card overflow-x-auto flex-shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-muted font-medium mr-1 flex-shrink-0">Etapa:</span>
              {stages.map(s => {
                const active = selected.current_stage_key === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => void changeStage(s.key)}
                    disabled={changingStage}
                    className={`flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                      active
                        ? 'text-white shadow-sm'
                        : 'border border-border text-muted hover:bg-bg-hover hover:text-[#0F172A]'
                    } ${changingStage ? 'opacity-50' : ''}`}
                    style={active ? { backgroundColor: s.color ?? '#8B1F1F' } : undefined}
                    title={s.name}
                  >
                    <span>{s.icon}</span>
                    <span>{s.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {selected.messages.map(msg => {
              const failed = msg.direction === 'out' && msg.delivery_status === 'failed';
              return (
              <div key={msg.id} className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                  msg.direction === 'out'
                    ? failed
                      ? 'bg-red-900/40 border border-red-500/60 text-white rounded-br-md'
                      : 'bg-crimson text-white rounded-br-md'
                    : 'bg-bg-card border border-border text-gray-200 rounded-bl-md'
                }`}>
                  {msg.direction === 'out' && msg.agentId && (
                    <div className="text-[10px] text-crimson-50/70 mb-1">
                      {dbAgents.find(a => a.id === msg.agentId)?.name.split(' ')[0]} ·
                    </div>
                  )}
                  {msg.media_type && msg.media_url ? (
                    <MessageMedia message={msg} onOpenLightbox={setLightboxUrl} />
                  ) : (
                    <LinkifiedText
                      text={msg.content}
                      className="leading-relaxed whitespace-pre-wrap"
                      linkClassName={
                        msg.direction === 'out'
                          ? 'underline underline-offset-2 hover:opacity-80 break-all text-white font-medium'
                          : 'underline underline-offset-2 hover:opacity-80 break-all text-crimson font-medium'
                      }
                    />
                  )}
                  <div className={`text-[10px] mt-1 flex items-center gap-1.5 ${msg.direction === 'out' ? (failed ? 'text-red-200' : 'text-white/50') : 'text-muted'}`}>
                    <span>{format(new Date(msg.timestamp), 'HH:mm')}</span>
                    {failed && (
                      <span title={msg.delivery_error ?? 'No se pudo entregar'} className="font-medium">
                        · ⚠ No entregado
                      </span>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply input */}
          <div className="border-t border-border p-4 bg-bg-card flex-shrink-0">
            {(() => {
              // Cálculo único de si el contacto se puede contactar desde el CRM AHORA.
              // Razones de bloqueo (devuelven canSend=false):
              //   - WSP/FB: hubo inbound previo pero el último fue hace >24h (Meta cierra
              //     la ventana de mensajería libre y rebota cualquier texto/audio/foto).
              //   - IG: sin manychat_subscriber_id (la app no tiene capability y MC no lo
              //     conoce; el send va a fallar siempre).
              // NO bloqueamos cuando NO hay inbound (contacto nuevo de form/captación):
              // el send va a auto-linkear via ManyChat Phone Import y el primer mensaje
              // suele entrar (depende del estado del subscriber pero al menos no es
              // determinístico que falle).
              const has24hRule = selected.channel === 'whatsapp' || selected.channel === 'facebook';
              const lastInbound = selected.messages
                .filter(m => m.direction === 'in')
                .reduce<string | null>((latest, m) => !latest || m.timestamp > latest ? m.timestamp : latest, null);
              const hoursSince = lastInbound ? (Date.now() - new Date(lastInbound).getTime()) / 3_600_000 : 0;
              const outsideWindow = has24hRule && !!lastInbound && hoursSince >= 24;
              const igUnlinked = selected.channel === 'instagram' && !selected.manychatSubscriberId;
              const canSend = !outsideWindow && !igUnlinked;
              const days = Math.floor(hoursSince / 24);
              const blockReason = outsideWindow
                ? `Última respuesta hace ${days >= 1 ? `${days}d` : `${Math.floor(hoursSince)}h`}. Mandá desde ${selected.channel === 'whatsapp' ? 'WhatsApp Business app' : 'Messenger app'} si es urgente.`
                : igUnlinked
                ? 'Respondé desde Instagram nativo hasta que escriba de nuevo.'
                : '';

              return (
                <>
                  {/* Banner unificado de bloqueo */}
                  {!canSend && (
                    <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                      <span className="flex-shrink-0 mt-0.5">{outsideWindow ? '⏰' : '📱'}</span>
                      <span>
                        <strong>{outsideWindow ? 'Fuera de ventana de 24hs.' : 'Instagram fuera del CRM.'}</strong>{' '}
                        {outsideWindow
                          ? `El cliente te escribió hace ${days >= 1 ? `${days}d` : `${Math.floor(hoursSince)}h`}. ${selected.channel === 'whatsapp' ? 'WhatsApp' : 'Facebook Messenger'} no entrega mensajes libres (texto, audio, foto, video) hasta que el cliente vuelva a escribirte.`
                          : 'Este contacto no se puede contactar desde el CRM porque no pasó por un flujo de ManyChat. Cuando vuelva a escribir se activa automáticamente.'}
                      </span>
                    </div>
                  )}
                  {sendError && (
                    <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-start gap-2">
                      <span className="flex-shrink-0 mt-0.5">⚠</span>
                      <span>{sendError}</span>
                      <button onClick={() => setSendError(null)} className="ml-auto flex-shrink-0 text-red-400 hover:text-red-600">✕</button>
                    </div>
                  )}
                  {/* Botones de acción: arriba del textarea en mobile, al lado en desktop */}
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                    <div className="flex gap-1.5 items-center overflow-x-auto sm:overflow-visible scrollbar-hide flex-shrink-0">
                      <TemplatePicker
                        lead={selected}
                        agent={currentUser}
                        onPick={rendered => setReply(prev => prev ? `${prev}\n${rendered}` : rendered)}
                      />
                      <ReplySuggestions
                        lead={selected}
                        agent={currentUser}
                        onPick={text => setReply(text)}
                      />
                      <ClientPortalButton
                        lead={selected}
                        agent={currentUser}
                      />
                      <AttachMediaButton
                        contactId={selected.id}
                        agentId={currentUser.dbId ?? ''}
                        channel={channelLabel(selected.channel)}
                        disabled={sending || !canSend}
                        onSent={() => { void refreshLeads(); }}
                      />
                      <RecordVoiceButton
                        contactId={selected.id}
                        agentId={currentUser.dbId ?? ''}
                        channel={channelLabel(selected.channel)}
                        disabled={sending || !canSend}
                        onSent={() => { void refreshLeads(); }}
                      />
                      {/* Botón de plantilla de reactivación: solo WSP. Visible siempre que
                          sea WSP — adentro del modal el picker filtra las plantillas
                          APPROVED disponibles. Si no hay ninguna, el modal lo aclara. */}
                      {selected.channel === 'whatsapp' && (
                        <TemplateReactivationPicker
                          lead={selected}
                          agent={currentUser}
                          onSent={() => { void refreshLeads(); }}
                        />
                      )}
                    </div>
                    <div className="flex gap-2 items-end flex-1 min-w-0">
                      <textarea
                        value={reply}
                        onChange={e => { setReply(e.target.value); if (sendError) setSendError(null); }}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) handleSend(); }}}
                        placeholder={canSend ? `Responder por ${channelLabel(selected.channel)}...` : 'Envío bloqueado por política del canal'}
                        rows={2}
                        disabled={!canSend}
                        className="flex-1 min-w-0 bg-bg-input border border-border rounded-xl px-4 py-3 text-sm text-white placeholder-muted outline-none focus:border-crimson resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <button
                        onClick={handleSend}
                        disabled={!reply.trim() || sending || !canSend}
                        title={!canSend ? blockReason : ''}
                        className="bg-crimson hover:bg-crimson-light text-white px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 min-w-[72px]"
                      >
                        {sending ? '...' : 'Enviar'}
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
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

      {/* Merge contacts modal */}
      {selected && showMerge && (
        <MergeContactsModal
          currentLeadId={selected.id}
          currentLeadName={selected.name}
          onClose={() => setShowMerge(false)}
          onMerged={() => { void refreshLeads(); setSelectedId(null); }}
        />
      )}

      {/* Assign modal */}
      <Modal open={showAssign} onClose={() => setShowAssign(false)} title="Asignar vendedor">
        <div className="space-y-2">
          {dbAgents.map(agent => {
            const initials = agent.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
            const isSelected = selected?.assignedTo === agent.id;
            return (
              <button
                key={agent.id}
                onClick={() => { if (selected) assignLead(selected.id, agent.id); setShowAssign(false); }}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  isSelected ? 'border-crimson bg-crimson/10' : 'border-border hover:bg-bg-hover'
                }`}
              >
                <Avatar initials={initials} imageUrl={agent.avatar_url ?? undefined} size="sm" />
                <div className="text-left flex-1">
                  <div className="text-white text-sm font-medium">{agent.name}</div>
                  <div className="text-muted text-xs">{agent.branch ?? '—'}</div>
                </div>
                {isSelected && <span className="text-crimson-bright text-sm">✓</span>}
              </button>
            );
          })}
        </div>
      </Modal>

      {lightboxUrl && (
        <div className="fixed inset-0 bg-black z-[60] flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <button onClick={() => setLightboxUrl(null)} className="absolute top-4 right-4 text-white text-2xl z-10">✕</button>
          <img src={lightboxUrl} alt="" className="max-h-full max-w-full object-contain" onClick={e => e.stopPropagation()} />
          <a href={lightboxUrl} download target="_blank" rel="noreferrer" className="absolute bottom-4 right-4 bg-white/90 text-black px-3 py-1.5 rounded-lg text-xs hover:bg-white">⬇ Descargar</a>
        </div>
      )}
    </div>
  );
}
