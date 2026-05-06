import { supabase } from './supabase';

export interface PropertyInput {
  address: string;
  barrio?: string;
  rooms?: number;
  bedrooms?: number;
  surface_m2?: number;
  surface_total_m2?: number;
  age_years?: number;
  property_state?: 'a_estrenar' | 'reciclado' | 'usado_buen_estado' | 'usado_regular';
  has_view?: boolean;
  view_type?: 'al_mar' | 'lateral_mar' | 'a_la_calle' | 'interno' | 'otro';
  amenities?: string[];
  expenses_ars?: number;
  floor_number?: number;
  exposure?: 'frente' | 'contrafrente' | 'lateral';
  notes?: string;
}

export interface AppraisalResult {
  appraisal_id: string | null;
  share_token: string;
  suggested_price_low_usd: number;
  suggested_price_high_usd: number;
  comparables: Array<{
    address: string;
    barrio?: string;
    price_usd: number;
    m2: number;
    rooms?: number;
    state?: string;
    age?: number;
    link?: string;
  }>;
  ai_reasoning: string;
  market_summary: string;
  recommendations: string[];
  estimated_sale_days: number;
}

export const appraisalsApi = {
  async create(args: {
    property: PropertyInput;
    client?: { name?: string; email?: string; phone?: string };
    photos?: Array<{ url: string; caption?: string }>;
    agent_id: string;
    agent_email?: string;
    contact_id?: string;
  }): Promise<AppraisalResult> {
    const { data, error } = await supabase.functions.invoke('appraise-property', {
      body: { ...args, save: true },
    });
    if (error) throw error;
    return data;
  },

  async list(): Promise<Array<{
    id: string;
    property_address: string;
    barrio: string | null;
    suggested_price_low_usd: number;
    suggested_price_high_usd: number;
    client_name: string | null;
    agent_id: string;
    created_at: string;
    status: string;
  }>> {
    const { data, error } = await supabase
      .from('appraisals')
      .select('id, property_address, barrio, suggested_price_low_usd, suggested_price_high_usd, client_name, agent_id, created_at, status')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  },

  async get(id: string) {
    const { data, error } = await supabase.from('appraisals').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },
};
