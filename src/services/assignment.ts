import { supabase } from './supabase';

export interface AssignmentConfig {
  id: number;
  enabled: boolean;
  strategy: 'round_robin' | 'load_balanced' | 'manual';
  default_branch: string | null;
}

export interface AgentLoad {
  id: string;
  name: string;
  email: string;
  branch: string | null;
  available: boolean | null;
  max_active_leads: number | null;
  channels: string[] | null;
  priority: number | null;
  last_assigned_at: string | null;
  active_leads: number;
}

export interface CapacityPatch {
  available?: boolean;
  max_active_leads?: number;
  channels?: string[];
  priority?: number;
  branch?: string;
}

export const assignmentApi = {
  async getConfig(): Promise<AssignmentConfig> {
    const { data, error } = await supabase
      .from('assignment_config')
      .select('*')
      .eq('id', 1)
      .single();
    if (error) throw error;
    return data as AssignmentConfig;
  },

  async updateConfig(patch: Partial<Pick<AssignmentConfig, 'enabled' | 'strategy' | 'default_branch'>>): Promise<void> {
    const { error } = await supabase
      .from('assignment_config')
      .update(patch)
      .eq('id', 1);
    if (error) throw error;
  },

  async listAgentLoad(): Promise<AgentLoad[]> {
    const { data, error } = await supabase
      .from('v_agent_load')
      .select('*')
      .order('active_leads', { ascending: false });
    if (error) throw error;
    return (data ?? []) as AgentLoad[];
  },

  async updateCapacity(agentId: string, patch: CapacityPatch): Promise<void> {
    // upsert: si no existe row para ese agent, crear
    const { data: existing } = await supabase
      .from('agent_capacity')
      .select('agent_id')
      .eq('agent_id', agentId)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase.from('agent_capacity').update(patch).eq('agent_id', agentId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('agent_capacity').insert({
        agent_id: agentId,
        available: true,
        max_active_leads: 30,
        channels: ['whatsapp', 'instagram', 'facebook', 'web'],
        priority: 100,
        ...patch,
      });
      if (error) throw error;
    }
  },
};
