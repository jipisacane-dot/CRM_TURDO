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
      // Si no, traer todo (admin). PostgREST tiene un default cap de 1000 rows si
      // no se especifica range → fix explícito a 10.000 para cubrir el crecimiento
      // del CRM más allá de 1k contacts (al 16/05 ya son 1122 y subiendo).
      let contactsQuery = supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false })
        .range(0, 9999);
      if (opts?.agentId) {
        contactsQuery = contactsQuery.eq('assigned_to', opts.agentId);
      }
      const { data: contacts, error: ce } = await contactsQuery;
      if (ce) throw ce;

      const contactList = (contacts ?? []) as DBContact[];
      if (contactList.length === 0) return [];

      // Trae los mensajes de TODOS los contacts cargados, chunkeado en grupos
      // de 80 contact_ids para no rebasar el URL limit de PostgREST (~14 KB)
      // ni el hard limit de 1000 rows por query. Sin esto:
      //  - .in() con muchos UUIDs → URL > 14KB → 400
      //  - sin filtro → trae últimos 1000 globales y deja sin mensajes a chats viejos
      // 80 UUIDs en URL ≈ 3 KB, queda holgado.
      const ids = contactList.map(c => c.id);
      const CHUNK = 80;
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

      const results = await Promise.all(
        chunks.map(chunk =>
          supabase
            .from('messages')
            .select('*')
            .in('contact_id', chunk)
            .order('created_at', { ascending: false })
            .limit(1000),
        ),
      );

      const allMessages: DBMessage[] = [];
      for (const r of results) {
        if (r.error) throw r.error;
        allMessages.push(...((r.data ?? []) as DBMessage[]));
      }
      // Orden ascendente (más viejo arriba, reciente abajo) para el UI del chat
      const messages = allMessages.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

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
