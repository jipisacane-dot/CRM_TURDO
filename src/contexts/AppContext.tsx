import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { Lead, Agent } from '../types';
import { AGENTS } from '../data/mock';
import { db, supabase, type DBContact, type DBMessage, type DBReminder } from '../services/supabase';
import { tokko } from '../services/tokko';

// ── Convert Supabase rows → CRM Lead type ─────────────────────────────────────

const toMessages = (rows: DBMessage[], channel: string) =>
  rows.map(m => ({
    id: m.id,
    direction: m.direction,
    content: m.content,
    timestamp: m.created_at,
    channel: channel as Lead['messages'][number]['channel'],
    agentId: m.agent_id ?? undefined,
    read: m.read,
  }));

const toLead = (c: DBContact & { current_stage_key?: string; stage_changed_at?: string }, messages: DBMessage[]): Lead => ({
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
  branch: (c.branch as Lead['branch']) ?? 'Sucursal Centro',
  createdAt: c.created_at,
  lastActivity: messages.length > 0 ? messages[messages.length - 1].created_at : c.created_at,
  messages: toMessages(messages, c.channel),
  notes: c.notes ?? undefined,
  current_stage_key: c.current_stage_key ?? 'nuevo',
  stage_changed_at: c.stage_changed_at,
});

// ── Context ───────────────────────────────────────────────────────────────────

interface SendResult {
  ok: boolean;
  outside_window?: boolean;
  error?: string;
}

interface AppContextType {
  currentUser: Agent;
  leads: Lead[];
  loading: boolean;
  refreshLeads: () => Promise<void>;
  assignLead: (leadId: string, agentId: string) => Promise<void>;
  updateLeadStatus: (leadId: string, status: Lead['status']) => Promise<void>;
  sendMessage: (leadId: string, content: string) => Promise<SendResult>;
  unreadCount: number;
  dueReminders: DBReminder[];
  createReminder: (contactId: string, title: string, dueAt: string, note?: string) => Promise<void>;
  completeReminder: (id: string) => Promise<void>;
  refreshReminders: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

function getSessionAgentId(): string {
  try {
    const raw = localStorage.getItem('crm_session');
    if (!raw) return 'leticia';
    return (JSON.parse(raw) as { agentId?: string }).agentId ?? 'leticia';
  } catch { return 'leticia'; }
}

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [dueReminders, setDueReminders] = useState<DBReminder[]>([]);
  const currentUser = AGENTS.find(a => a.id === getSessionAgentId()) ?? AGENTS[0];

  const refreshLeads = useCallback(async () => {
    setLoading(true);
    try {
      // Vendedores solo ven sus contactos asignados (filtro server-side).
      // Admin (Leticia) ve todo.
      const opts = currentUser.role === 'agent' ? { agentId: currentUser.id } : undefined;
      const contacts = await db.contacts.listWithMessages(opts);
      setLeads(contacts.map(c => toLead(c, c.messages)));
    } catch (e) {
      console.error('Error cargando leads:', e);
    } finally {
      setLoading(false);
    }
  }, [currentUser.id, currentUser.role]);

  const refreshReminders = useCallback(async () => {
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
  }, []);

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
    currentUser, leads, loading, refreshLeads, assignLead, updateLeadStatus,
    sendMessage, unreadCount, dueReminders, createReminder, completeReminder, refreshReminders,
  }), [currentUser, leads, loading, refreshLeads, unreadCount, dueReminders, refreshReminders]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
