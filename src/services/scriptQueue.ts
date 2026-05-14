import { supabase } from './supabase';

export type ScriptStatus = 'pending' | 'notified' | 'in_progress' | 'completed' | 'cancelled';

export interface ScriptQueueItem {
  id: string;
  tracking_code: string;
  url: string;
  note: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  ai_summary: string | null;
  status: ScriptStatus;
  jipi_response: string | null;
  telegram_msg_id_out: number | null;
  telegram_msg_id_in: number | null;
  created_at: string;
  notified_at: string | null;
  completed_at: string | null;
  property_id: string | null;
}

export const STATUS_LABELS: Record<ScriptStatus, string> = {
  pending: 'Pendiente',
  notified: 'Enviado a Nacho',
  in_progress: 'En proceso',
  completed: '✅ Completado',
  cancelled: 'Cancelado',
};

export const STATUS_COLORS: Record<ScriptStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  notified: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export const scriptQueue = {
  async list(): Promise<ScriptQueueItem[]> {
    const { data, error } = await supabase
      .from('script_queue')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async create(input: {
    url: string;
    note?: string;
    requested_by?: string | null;
    requested_by_name?: string | null;
  }): Promise<ScriptQueueItem> {
    const { data, error } = await supabase
      .from('script_queue')
      .insert({
        url: input.url,
        note: input.note ?? null,
        requested_by: input.requested_by ?? null,
        requested_by_name: input.requested_by_name ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    // Fire and forget notification
    void supabase.functions.invoke('notify-script-queue', {
      body: { script_queue_id: data.id },
    }).catch((e) => console.warn('notify-script-queue err', e));
    return data;
  },

  async cancel(id: string): Promise<void> {
    const { error } = await supabase.from('script_queue').update({ status: 'cancelled' }).eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('script_queue').delete().eq('id', id);
    if (error) throw error;
  },
};
