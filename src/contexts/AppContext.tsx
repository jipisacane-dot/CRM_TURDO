import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { Lead, Agent } from '../types';
import { AGENTS } from '../data/mock';
import { db, supabase, type DBContact, type DBMessage, type DBReminder } from '../services/supabase';
import { tokko } from '../services/tokko';

// ── Convert Supabase rows → CRM Lead type ─────────────────────────────────────

const toMessages = (rows: DBMessage[], channel: string): Lead['messages'] =>
  rows.map(m => ({
    id: m.id,
    direction: m.direction,
    content: m.content,
    timestamp: m.created_at,
    channel: channel as Lead['messages'][number]['channel'],
    agentId: m.agent_id ?? undefined,
    read: m.read,
    media_type: (m.media_type as Lead['messages'][number]['media_type']) ?? null,
    media_url: m.media_url ?? null,
    media_path: m.media_path ?? null,
    media_caption: m.media_caption ?? null,
    media_mime: m.media_mime ?? null,
    media_filename: m.media_filename ?? null,
    media_size_bytes: m.media_size_bytes ?? null,
  }));

const toLead = (c: DBContact & { current_stage_key?: string | null; stage_changed_at?: string | null; duplicate_of?: string | null; quality_label?: string | null; quality_score?: number | null; quality_reason?: string | null }, messages: DBMessage[]): Lead => ({
  id: c.id,
  name: c.name ?? 'Sin nombre',
  phone: c.phone ?? undefined,
  email: c.email ?? undefined,
  avatarUrl: c.avatar_url ?? undefined,
  channel: c.channel as Lead['channel'],
  propertyId: c.property_id ?? undefined,
  propertyTitle: c.property_title ?? undefined,
  status: (c.status as Lead['status']) ?? 'new',
  assignedTo: c.assigned_to ?? undefined,
  branch: (c.branch as Lead['branch']) ?? 'Corrientes',
  createdAt: c.created_at,
  lastActivity: messages.length > 0 ? messages[messages.length - 1].created_at : c.created_at,
  messages: toMessages(messages, c.channel),
  notes: c.notes ?? undefined,
  current_stage_key: c.current_stage_key ?? 'nuevo',
  stage_changed_at: c.stage_changed_at ?? undefined,
  duplicate_of: c.duplicate_of ?? undefined,
  quality_label: (c.quality_label as Lead['quality_label']) ?? undefined,
  quality_score: c.quality_score ?? undefined,
  quality_reason: c.quality_reason ?? undefined,
});

// ── Context ───────────────────────────────────────────────────────────────────

interface SendResult {
  ok: boolean;
  outside_window?: boolean;
  error?: string;
}

interface AppContextType {
  currentUser: Agent & { dbId: string | null };
  leads: Lead[];
  loading: boolean;
  refreshLeads: () => Promise<void>;
  loadLeadMessages: (leadId: string) => Promise<void>;
  assignLead: (leadId: string, agentId: string) => Promise<void>;
  bulkAssign: (leadIds: string[], agentId: string) => Promise<{ updated: number; error?: string }>;
  updateLeadStatus: (leadId: string, status: Lead['status']) => Promise<void>;
  sendMessage: (leadId: string, content: string) => Promise<SendResult>;
  unreadCount: number;
  dueReminders: DBReminder[];
  createReminder: (contactId: string, title: string, dueAt: string, note?: string) => Promise<void>;
  completeReminder: (id: string) => Promise<void>;
  refreshReminders: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

// Determina el agente actual a partir del email de la sesión Supabase Auth.
// Si todavía no hay sesión, devuelve el primer agente del mock como placeholder
// (LoginGate redirecciona a /login antes de que esto importe en producción).
function resolveBaseUser(authEmail: string | null) {
  if (authEmail) {
    const fromAuth = AGENTS.find(a => a.email.toLowerCase() === authEmail.toLowerCase());
    if (fromAuth) return fromAuth;
  }
  return AGENTS[0];
}

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [dueReminders, setDueReminders] = useState<DBReminder[]>([]);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const baseUser = resolveBaseUser(authEmail);
  // dbId = UUID real del agent en Supabase (resuelto via email).
  // Es lo que se usa para filtros que comparan contra contacts.assigned_to (UUID en DB).
  const [agentDbId, setAgentDbId] = useState<string | null>(null);
  const currentUser = { ...baseUser, dbId: agentDbId };

  // Leer sesión Supabase Auth al montar y suscribirse a cambios.
  // sessionLoaded gate evita race condition: queries esperan al JWT antes de correr
  // (sino corren con anon_key y RLS devuelve [] silenciosamente).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthEmail(data.session?.user?.email ?? null);
      setSessionLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthEmail(session?.user?.email ?? null);
      setSessionLoaded(true);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  // Resolver UUID real del agent al iniciar sesión (cache en localStorage para evitar lookup constante)
  useEffect(() => {
    if (!baseUser.email) return;
    const cacheKey = `agent_dbid_${baseUser.email}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { setAgentDbId(cached); return; }
    supabase.from('agents').select('id').eq('email', baseUser.email).maybeSingle().then(({ data }) => {
      if (data?.id) {
        setAgentDbId(data.id);
        localStorage.setItem(cacheKey, data.id);
      }
    });
  }, [baseUser.email]);

  const refreshLeads = useCallback(async () => {
    // Esperar a que la sesión Supabase Auth esté cargada — sino la query
    // corre con anon_key y RLS devuelve [] silenciosamente.
    if (!sessionLoaded) return;
    // Si es vendedor pero todavía no resolvimos su dbId, esperar.
    if (baseUser.role === 'agent' && !agentDbId) return;
    setLoading(true);
    try {
      // Vendedores solo ven sus contactos asignados (filtro server-side por UUID real).
      // Admin (Leticia) ve todo.
      const opts = baseUser.role === 'agent' && agentDbId ? { agentId: agentDbId } : undefined;
      const contacts = await db.contacts.listWithMessages(opts);
      setLeads(contacts.map(c => toLead(c, c.messages)));
    } catch (e) {
      console.error('Error cargando leads:', e);
    } finally {
      setLoading(false);
    }
  }, [sessionLoaded, agentDbId, baseUser.role]);

  // Trae los mensajes completos de un lead específico (1 query targeted).
  // Garantiza que el chat abierto siempre tiene todos los mensajes,
  // sin importar cuánto crezca la tabla messages global.
  const loadLeadMessages = useCallback(async (leadId: string) => {
    if (!sessionLoaded) return;
    try {
      const msgs = await db.messages.forContact(leadId);
      setLeads(prev => prev.map(l => {
        if (l.id !== leadId) return l;
        return {
          ...l,
          messages: toMessages(msgs, l.channel),
          lastActivity: msgs.length > 0 ? msgs[msgs.length - 1].created_at : l.lastActivity,
        };
      }));
    } catch (e) {
      console.error('Error cargando mensajes del lead:', leadId, e);
    }
  }, [sessionLoaded]);

  const refreshReminders = useCallback(async () => {
    if (!sessionLoaded) return;
    try {
      const due = await db.reminders.listDue();
      setDueReminders(prev => {
        // Send push for reminders that just became due (not already in state)
        const prevIds = new Set(prev.map(r => r.id));
        const newDue = due.filter(r => !prevIds.has(r.id));
        for (const r of newDue) {
          supabase.functions.invoke('send-push', {
            body: {
              title: `🔔 ${r.title}`,
              body: r.note ?? 'Recordatorio vencido',
              contact_id: r.contact_id,
              url: '/inbox',
              agent_id: r.agent_id ?? undefined,
            },
          }).catch(console.error);
        }
        return due;
      });
    } catch (e) {
      console.error('Error cargando recordatorios:', e);
    }
  }, [sessionLoaded]);

  const createReminder = async (contactId: string, title: string, dueAt: string, note?: string) => {
    await db.reminders.create({
      contact_id: contactId,
      title,
      due_at: dueAt,
      note: note ?? null,
      done: false,
      agent_id: currentUser.id,
    });
    await refreshReminders();
  };

  const completeReminder = async (id: string) => {
    await db.reminders.complete(id);
    setDueReminders(prev => prev.filter(r => r.id !== id));
  };

  // Load on mount
  useEffect(() => {
    refreshLeads();
    refreshReminders();
    // Pre-warm Tokko cache pero diferido para no competir con la carga inicial
    if (tokko.hasKey()) {
      setTimeout(() => { tokko.getProperties().catch(() => {}); }, 1500);
    }
  }, [refreshLeads, refreshReminders]);

  // Check reminders every 5 min
  useEffect(() => {
    const interval = setInterval(refreshReminders, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshReminders]);

  // Realtime subscription — update only the affected contact
  useEffect(() => {
    const channel = supabase
      .channel('crm-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const newMsg = payload.new as DBMessage;
        const messages = await db.messages.forContact(newMsg.contact_id);
        setLeads(prev => prev.map(l => {
          if (l.id !== newMsg.contact_id) return l;
          return {
            ...l,
            lastActivity: newMsg.created_at,
            messages: toMessages(messages, l.channel),
          };
        }));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contacts' }, () => {
        refreshLeads();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [refreshLeads]);

  const assignLead = async (leadId: string, agentId: string) => {
    const lead = leads.find(l => l.id === leadId);
    await db.contacts.update(leadId, {
      assigned_to: agentId,
      status: lead?.status === 'new' ? 'contacted' : undefined,
    });
    setLeads(prev => prev.map(l =>
      l.id === leadId
        ? { ...l, assignedTo: agentId, status: l.status === 'new' ? 'contacted' : l.status }
        : l
    ));
    // Notify the assigned agent
    supabase.functions.invoke('send-push', {
      body: {
        title: '📋 Lead asignado',
        body: `${lead?.name ?? 'Nuevo contacto'} fue asignado a vos`,
        contact_id: leadId,
        url: '/inbox',
        agent_id: agentId,
      },
    }).catch(console.error);
  };

  const bulkAssign = async (leadIds: string[], agentId: string): Promise<{ updated: number; error?: string }> => {
    if (leadIds.length === 0) return { updated: 0 };

    // Batch update in chunks of 500 (PostgREST URL limits)
    const CHUNK = 500;
    let totalUpdated = 0;
    for (let i = 0; i < leadIds.length; i += CHUNK) {
      const chunk = leadIds.slice(i, i + CHUNK);
      const { error, count } = await supabase
        .from('contacts')
        .update({ assigned_to: agentId }, { count: 'exact' })
        .in('id', chunk);
      if (error) {
        console.error('[bulkAssign] error:', error);
        return { updated: totalUpdated, error: error.message };
      }
      totalUpdated += count ?? chunk.length;
    }

    // Update local state
    setLeads(prev => prev.map(l =>
      leadIds.includes(l.id) ? { ...l, assignedTo: agentId } : l
    ));

    // Single notification (not 1 per lead)
    supabase.functions.invoke('send-push', {
      body: {
        title: '📋 Leads asignados',
        body: `Te asignaron ${totalUpdated} contacto${totalUpdated === 1 ? '' : 's'}`,
        url: '/contacts',
        agent_id: agentId,
      },
    }).catch(console.error);

    return { updated: totalUpdated };
  };

  const updateLeadStatus = async (leadId: string, status: Lead['status']) => {
    await db.contacts.update(leadId, { status });
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
  };

  const sendMessage = async (leadId: string, content: string): Promise<SendResult> => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return { ok: false, error: 'Lead not found' };

    // Optimistic update — show message instantly
    const tempId = `temp_${Date.now()}`;
    const now = new Date().toISOString();
    setLeads(prev => prev.map(l =>
      l.id === leadId
        ? {
            ...l,
            lastActivity: now,
            messages: [...l.messages, {
              id: tempId,
              direction: 'out' as const,
              content,
              timestamp: now,
              channel: lead.channel,
              agentId: currentUser.id,
              read: true,
            }],
          }
        : l
    ));

    const { data, error } = await supabase.functions.invoke('send-message', {
      body: { contact_id: leadId, content, agent_id: currentUser.id },
    });

    if (error) {
      console.error('Error sending message:', error);
      return { ok: false, error: error.message };
    }

    const delivery = data?.delivery;
    if (delivery && !delivery.ok) {
      return {
        ok: false,
        outside_window: delivery.outside_window,
        error: delivery.error,
      };
    }

    return { ok: true };
  };

  const unreadCount = useMemo(
    () => leads.reduce((sum, lead) => sum + lead.messages.filter(m => !m.read && m.direction === 'in').length, 0),
    [leads]
  );

  const value = useMemo<AppContextType>(() => ({
    currentUser, leads, loading, refreshLeads, loadLeadMessages, assignLead, bulkAssign, updateLeadStatus,
    sendMessage, unreadCount, dueReminders, createReminder, completeReminder, refreshReminders,
  }), [currentUser, leads, loading, refreshLeads, loadLeadMessages, unreadCount, dueReminders, refreshReminders]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
