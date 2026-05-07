import { supabase } from './supabase';
import type { Lead, Agent } from '../types';

export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
  category: string;
  agent_id: string | null;
  shortcut: string | null;
  use_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type TemplatePatch = Partial<Pick<MessageTemplate, 'name' | 'body' | 'category' | 'shortcut' | 'agent_id'>>;

export const templatesApi = {
  async listForAgent(agentId: string): Promise<MessageTemplate[]> {
    const { data, error } = await supabase
      .from('message_templates')
      .select('*')
      .or(`agent_id.is.null,agent_id.eq.${agentId}`)
      .order('use_count', { ascending: false });
    if (error) throw error;
    return (data ?? []) as MessageTemplate[];
  },

  async create(t: TemplatePatch & { name: string; body: string; created_by: string }): Promise<MessageTemplate> {
    const { data, error } = await supabase
      .from('message_templates')
      .insert(t)
      .select()
      .single();
    if (error) throw error;
    return data as MessageTemplate;
  },

  async update(id: string, patch: TemplatePatch): Promise<void> {
    const { error } = await supabase.from('message_templates').update(patch).eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('message_templates').delete().eq('id', id);
    if (error) throw error;
  },

  async incrementUse(id: string): Promise<void> {
    // increment via RPC-like approach: fetch + update (best-effort, no race-critical)
    const { data } = await supabase.from('message_templates').select('use_count').eq('id', id).single();
    if (data) {
      await supabase.from('message_templates').update({ use_count: (data.use_count ?? 0) + 1 }).eq('id', id);
    }
  },
};

// Reemplaza variables del template con los datos del lead/agente actual.
// Variables soportadas: {nombre}, {telefono}, {email}, {propiedad}, {agente}, {sucursal}
export function renderTemplate(body: string, ctx: { lead: Lead; agent: Agent }): string {
  const { lead, agent } = ctx;
  const firstName = (lead.name ?? '').split(' ')[0] || lead.name || '';
  return body
    .replaceAll('{nombre}', firstName)
    .replaceAll('{telefono}', lead.phone ?? '')
    .replaceAll('{email}', lead.email ?? '')
    .replaceAll('{propiedad}', lead.propertyTitle ?? 'la propiedad consultada')
    .replaceAll('{agente}', agent.name.split(' ')[0])
    .replaceAll('{sucursal}', lead.branch ?? 'Sucursal Centro');
}
