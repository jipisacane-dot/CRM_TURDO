import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Lead, Agent } from '../types';
import { AGENTS } from '../data/mock';
import { db, supabase, type DBContact, type DBMessage } from '../services/supabase';

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

const toLead = (c: DBContact, messages: DBMessage[]): Lead => ({
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
});

// ── Context ───────────────────────────────────────────────────────────────────

interface AppContextType {
  currentUser: Agent;
  leads: Lead[];
  loading: boolean;
  refreshLeads: () => Promise<void>;
  assignLead: (leadId: string, agentId: string) => Promise<void>;
  updateLeadStatus: (leadId: string, status: Lead['status']) => Promise<void>;
  sendMessage: (leadId: string, content: string) => Promise<void>;
  unreadCount: number;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const currentUser = AGENTS.find(a => a.id === 'leticia')!;

  const refreshLeads = useCallback(async () => {
    setLoading(true);
    try {
      const contacts = await db.contacts.list();
      const leadsWithMessages = await Promise.all(
        contacts.map(async c => {
          const messages = await db.messages.forContact(c.id);
          return toLead(c, messages);
        })
      );
      setLeads(leadsWithMessages);
    } catch (e) {
      console.error('Error cargando leads:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => { refreshLeads(); }, [refreshLeads]);

  // Realtime subscription for new messages
  useEffect(() => {
    const channel = supabase
      .channel('crm-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        refreshLeads();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contacts' }, () => {
        refreshLeads();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [refreshLeads]);

  const assignLead = async (leadId: string, agentId: string) => {
    await db.contacts.update(leadId, {
      assigned_to: agentId,
      status: leads.find(l => l.id === leadId)?.status === 'new' ? 'contacted' : undefined,
    });
    setLeads(prev => prev.map(l =>
      l.id === leadId
        ? { ...l, assignedTo: agentId, status: l.status === 'new' ? 'contacted' : l.status }
        : l
    ));
  };

  const updateLeadStatus = async (leadId: string, status: Lead['status']) => {
    await db.contacts.update(leadId, { status });
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
  };

  const sendMessage = async (leadId: string, content: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

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

    const { error } = await supabase.functions.invoke('send-message', {
      body: { contact_id: leadId, content, agent_id: currentUser.id },
    });

    if (error) console.error('Error sending message:', error);
  };

  const unreadCount = leads.reduce((sum, lead) =>
    sum + lead.messages.filter(m => !m.read && m.direction === 'in').length, 0);

  return (
    <AppContext.Provider value={{ currentUser, leads, loading, refreshLeads, assignLead, updateLeadStatus, sendMessage, unreadCount }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
