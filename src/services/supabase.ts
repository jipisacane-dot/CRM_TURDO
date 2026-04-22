import { createClient } from '@supabase/supabase-js';

const URL  = import.meta.env.VITE_SUPABASE_URL  as string;
const KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(URL, KEY);

// ── Types matching the DB schema ──────────────────────────────────────────────

export interface DBContact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  channel: string;
  channel_id: string | null;
  status: string;
  assigned_to: string | null;
  property_id: string | null;
  property_title: string | null;
  branch: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBMessage {
  id: string;
  contact_id: string;
  direction: 'in' | 'out';
  content: string;
  channel: string;
  meta_mid: string | null;
  agent_id: string | null;
  read: boolean;
  created_at: string;
}

export interface DBReminder {
  id: string;
  contact_id: string;
  title: string;
  note: string | null;
  due_at: string;
  done: boolean;
  agent_id: string | null;
  created_at: string;
}

// ── Contacts ──────────────────────────────────────────────────────────────────

export const db = {
  contacts: {
    async list(): Promise<DBContact[]> {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },

    async listWithMessages(): Promise<Array<DBContact & { messages: DBMessage[] }>> {
      const { data, error } = await supabase
        .from('contacts')
        .select('*, messages(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c: DBContact & { messages: DBMessage[] }) => ({
        ...c,
        messages: (c.messages ?? []).sort(
          (a: DBMessage, b: DBMessage) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
      }));
    },

    async upsert(contact: Partial<DBContact>): Promise<DBContact> {
      const { data, error } = await supabase
        .from('contacts')
        .upsert(contact)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async update(id: string, fields: Partial<DBContact>): Promise<void> {
      const { error } = await supabase
        .from('contacts')
        .update(fields)
        .eq('id', id);
      if (error) throw error;
    },

    async findByChannelId(channelId: string, channel: string): Promise<DBContact | null> {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('channel_id', channelId)
        .eq('channel', channel)
        .maybeSingle();
      return data;
    },
  },

  messages: {
    async forContact(contactId: string): Promise<DBMessage[]> {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },

    async insert(msg: Omit<DBMessage, 'id' | 'created_at'>): Promise<DBMessage> {
      const { data, error } = await supabase
        .from('messages')
        .insert(msg)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async markRead(contactId: string): Promise<void> {
      await supabase
        .from('messages')
        .update({ read: true })
        .eq('contact_id', contactId)
        .eq('direction', 'in');
    },
  },

  reminders: {
    async listDue(): Promise<DBReminder[]> {
      const { data, error } = await supabase
        .from('reminders')
        .select('*')
        .eq('done', false)
        .lte('due_at', new Date().toISOString())
        .order('due_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },

    async forContact(contactId: string): Promise<DBReminder[]> {
      const { data, error } = await supabase
        .from('reminders')
        .select('*')
        .eq('contact_id', contactId)
        .eq('done', false)
        .order('due_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },

    async create(reminder: Omit<DBReminder, 'id' | 'created_at'>): Promise<DBReminder> {
      const { data, error } = await supabase
        .from('reminders')
        .insert(reminder)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async complete(id: string): Promise<void> {
      const { error } = await supabase
        .from('reminders')
        .update({ done: true })
        .eq('id', id);
      if (error) throw error;
    },
  },
};
