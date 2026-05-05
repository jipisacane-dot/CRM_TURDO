import { supabase } from './supabase';

export interface PortalSummary {
  portal_id: string;
  token: string;
  contact_id: string;
  agent_id: string;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  view_count: number;
  last_viewed_at: string | null;
  property_ids: string[];
  contact_name: string | null;
  total_events: number;
  first_view_at: string | null;
  unique_views: number;
}

export interface PortalEvent {
  id: string;
  portal_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

export interface CreatedPortal {
  portal_id: string;
  token: string;
  url: string;
  expires_at: string;
}

export const portalsApi = {
  async create(args: { contact_id: string; agent_id: string; agent_email?: string; property_ids: string[]; greeting?: string | null }): Promise<CreatedPortal> {
    const { data, error } = await supabase.functions.invoke('create-client-portal', { body: args });
    if (error) throw error;
    return data as CreatedPortal;
  },

  async listForContact(contactId: string): Promise<PortalSummary[]> {
    const { data, error } = await supabase
      .from('v_portal_summary')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as PortalSummary[];
  },

  async listEvents(portalId: string, limit = 30): Promise<PortalEvent[]> {
    const { data, error } = await supabase
      .from('portal_events')
      .select('*')
      .eq('portal_id', portalId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as PortalEvent[];
  },

  async deactivate(portalId: string): Promise<void> {
    const { error } = await supabase.from('client_portals').update({ is_active: false }).eq('id', portalId);
    if (error) throw error;
  },
};
