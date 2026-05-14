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
  current_stage_key: string | null;
  stage_changed_at: string | null;
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
  media_type?: string | null;
  media_url?: string | null;
  media_path?: string | null;
  media_caption?: string | null;
  media_mime?: string | null;
  media_filename?: string | null;
  media_size_bytes?: number | null;
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

    async listWithMessages(opts?: { agentId?: string }): Promise<Array<DBContact & { messages: DBMessage[] }>> {
      // Si se pasa agentId, filtrar contactos asignados a ese agente (server-side).
      // Si no, traer todo (admin).
      let contactsQuery = supabase.from('contacts').select('*').order('created_at', { ascending: false });
      if (opts?.agentId) {
        contactsQuery = contactsQuery.eq('assigned_to', opts.agentId);
      }
      const { data: contacts, error: ce } = await contactsQuery;
      if (ce) throw ce;

      const contactList = (contacts ?? []) as DBContact[];
      if (contactList.length === 0) return [];

      // Notas críticas:
      //   1. .in('contact_id', [387 UUIDs]) genera URL > 14KB → PostgREST HTTP 400.
      //      Solo usamos .in() cuando hay pocos contactos (vendedor).
      //   2. Supabase tiene HARD LIMIT 1000 rows por query (no se puede superar
      //      con .range()). Ordenamos DESC para traer los 1000 mensajes MÁS
      //      RECIENTES y los revertimos en cliente. Los chats activos quedan
      //      completos; solo se pierden mensajes muy viejos (>1000 mensajes
      //      atrás), que en la UI raramente importan.
      const ids = contactList.map(c => c.id);
      let messagesQuery = supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (ids.length <= 100) {
        messagesQuery = messagesQuery.in('contact_id', ids);
      }
      const { data: messagesDesc, error: me } = await messagesQuery;
      if (me) throw me;
      // Revertir para que el orden quede ascendente (más viejo arriba, reciente abajo).
      const messages = ((messagesDesc ?? []) as DBMessage[]).reverse();

      const msgByContact = new Map<string, DBMessage[]>();
      for (const m of (messages ?? []) as DBMessage[]) {
        const arr = msgByContact.get(m.contact_id) ?? [];
        arr.push(m);
        msgByContact.set(m.contact_id, arr);
      }
      return contactList.map((c: DBContact) => ({
        ...c,
        messages: msgByContact.get(c.id) ?? [],
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
      // Limit 1000 es el cap duro de PostgREST. Si un chat tiene >1000 mensajes
      // (improbable, pero), traemos los 1000 más recientes y revertimos.
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return ((data ?? []) as DBMessage[]).reverse();
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
