import { supabase } from './supabase';

export interface PipelineStage {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
  is_terminal: boolean;
  requires_followup_after_days: number | null;
}

export interface ContactStageChange {
  id: string;
  contact_id: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
  reason: string | null;
  auto_detected: boolean;
}

export interface FollowupDue {
  contact_id: string;
  name: string | null;
  phone: string | null;
  channel: string;
  assigned_to: string | null;
  current_stage_key: string;
  stage_name: string;
  stage_changed_at: string;
  requires_followup_after_days: number;
  days_in_stage: number;
}

export const pipelineStagesApi = {
  async list(): Promise<PipelineStage[]> {
    const { data, error } = await supabase
      .from('pipeline_stages')
      .select('*')
      .order('sort_order');
    if (error) throw error;
    return (data ?? []) as PipelineStage[];
  },
};

export const pipelineApi = {
  /** Cambia la etapa actual del contacto. El trigger DB registra el historial. */
  async changeStage(contactId: string, newStageKey: string): Promise<void> {
    const { error } = await supabase
      .from('contacts')
      .update({ current_stage_key: newStageKey })
      .eq('id', contactId);
    if (error) throw error;
  },

  async stageHistory(contactId: string): Promise<ContactStageChange[]> {
    const { data, error } = await supabase
      .from('contact_stage_changes')
      .select('*')
      .eq('contact_id', contactId)
      .order('changed_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ContactStageChange[];
  },

  async followupsDue(): Promise<FollowupDue[]> {
    const { data, error } = await supabase.from('v_followups_due').select('*');
    if (error) throw error;
    return ((data ?? []) as FollowupDue[]).map(r => ({
      ...r,
      days_in_stage: Math.round(Number(r.days_in_stage)),
    }));
  },
};
