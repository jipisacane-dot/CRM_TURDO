import { supabase } from './supabase';

export interface PendingMatch {
  id: string;
  property_id: string;
  contact_id: string;
  score: number;
  reasons: string[];
  created_at: string;
  contact_name: string | null;
  contact_channel: string;
  contact_phone: string | null;
  contact_email: string | null;
  contact_assigned_to: string | null;
  current_stage_key: string | null;
  quality_label: 'hot' | 'warm' | 'cold' | null;
  property_address: string | null;
  property_barrio: string | null;
  property_price: number | null;
  property_rooms: number | null;
}

export const matchesApi = {
  async listForProperty(propertyId: string): Promise<PendingMatch[]> {
    const { data, error } = await supabase
      .from('v_pending_matches')
      .select('*')
      .eq('property_id', propertyId)
      .order('score', { ascending: false });
    if (error) throw error;
    return (data ?? []) as PendingMatch[];
  },

  async listForContact(contactId: string): Promise<PendingMatch[]> {
    const { data, error } = await supabase
      .from('v_pending_matches')
      .select('*')
      .eq('contact_id', contactId)
      .order('score', { ascending: false });
    if (error) throw error;
    return (data ?? []) as PendingMatch[];
  },

  async listAll(): Promise<PendingMatch[]> {
    const { data, error } = await supabase
      .from('v_pending_matches')
      .select('*')
      .order('score', { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as PendingMatch[];
  },

  async dismiss(matchId: string): Promise<void> {
    const { error } = await supabase
      .from('property_lead_matches')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', matchId);
    if (error) throw error;
  },

  async markNotified(matchId: string, agentId: string): Promise<void> {
    const { error } = await supabase
      .from('property_lead_matches')
      .update({ notified_at: new Date().toISOString(), notified_by: agentId })
      .eq('id', matchId);
    if (error) throw error;
  },

  async runMatchForProperty(propertyId: string): Promise<{ matches: number }> {
    const { data, error } = await supabase.functions.invoke('match-property-to-leads', {
      body: { property_id: propertyId, min_score: 50 },
    });
    if (error) throw error;
    return data;
  },

  async inferPreferencesForContact(contactId: string): Promise<unknown> {
    const { data, error } = await supabase.functions.invoke('infer-lead-preferences', {
      body: { contact_id: contactId },
    });
    if (error) throw error;
    return data;
  },
};
