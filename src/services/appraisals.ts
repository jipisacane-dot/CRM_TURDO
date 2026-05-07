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
  is_furnished?: boolean;
  notes?: string;
}

export interface AppraisalResult {
  appraisal_id: string | null;
  share_token: string;
  suggested_price_low_usd: number;
  suggested_price_high_usd: number;
  comparables: Array<{
    source?: string;
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
  calculation_breakdown?: string;
  market_summary: string;
  recommendations: string[];
  estimated_sale_days: number;
}

export const appraisalsApi = {
  // Preview: tasa pero NO guarda en DB. El agente puede revisar / editar precios antes de confirmar.
  async preview(args: {
    property: PropertyInput;
    client?: { name?: string; email?: string; phone?: string };
    photos?: Array<{ url: string; caption?: string }>;
    agent_id: string;
    agent_email?: string;
    contact_id?: string;
  }): Promise<AppraisalResult> {
    const { data, error } = await supabase.functions.invoke('appraise-property', {
      body: { ...args, save: false },
    });
    if (error) throw error;
    return data;
  },

  // Confirma y guarda en DB. Recibe los datos del preview + precios potencialmente editados por el agente.
  async confirm(args: {
    property: PropertyInput;
    client?: { name?: string; email?: string; phone?: string };
    photos?: Array<{ url: string; caption?: string }>;
    agent_id: string;
    agent_email?: string;
    contact_id?: string;
    suggested_price_low_usd: number;
    suggested_price_high_usd: number;
    ai_suggested_low_usd?: number;
    ai_suggested_high_usd?: number;
    comparables: AppraisalResult['comparables'];
    ai_reasoning: string;
    calculation_breakdown?: string;
    market_summary: string;
    recommendations: string[];
    estimated_sale_days: number;
  }): Promise<{ appraisal_id: string; share_token: string }> {
    const { data, error } = await supabase.functions.invoke('save-appraisal', {
      body: args,
    });
    if (error) throw error;
    return data;
  },

  async update(args: {
    appraisal_id: string;
    suggested_price_low_usd?: number;
    suggested_price_high_usd?: number;
    notes?: string;
    status?: string;
  }): Promise<{ id: string; share_token: string; suggested_price_low_usd: number; suggested_price_high_usd: number }> {
    const { data, error } = await supabase.functions.invoke('update-appraisal', {
      body: args,
    });
    if (error) throw error;
    return data;
  },

  async list(opts?: { agentEmail?: string }): Promise<Array<{
    id: string;
    share_token: string;
    property_address: string;
    barrio: string | null;
    rooms: number | null;
    surface_m2: number | null;
    property_state: string | null;
    suggested_price_low_usd: number;
    suggested_price_high_usd: number;
    ai_suggested_low_usd: number | null;
    ai_suggested_high_usd: number | null;
    client_name: string | null;
    agent_id: string;
    agent_name: string | null;
    agent_email: string | null;
    created_at: string;
    status: string;
    view_count: number | null;
  }>> {
    let q = supabase
      .from('appraisals')
      .select('id, share_token, property_address, barrio, rooms, surface_m2, property_state, suggested_price_low_usd, suggested_price_high_usd, ai_suggested_low_usd, ai_suggested_high_usd, client_name, agent_id, created_at, status, view_count, agent:agents(name, email)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (opts?.agentEmail) {
      const { data: a } = await supabase.from('agents').select('id').eq('email', opts.agentEmail).maybeSingle();
      if (a?.id) q = q.eq('agent_id', a.id);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>) => {
      const agent = (r.agent as { name?: string; email?: string } | null) ?? null;
      return {
        id: r.id as string,
        share_token: r.share_token as string,
        property_address: r.property_address as string,
        barrio: r.barrio as string | null,
        rooms: r.rooms as number | null,
        surface_m2: r.surface_m2 as number | null,
        property_state: r.property_state as string | null,
        suggested_price_low_usd: r.suggested_price_low_usd as number,
        suggested_price_high_usd: r.suggested_price_high_usd as number,
        ai_suggested_low_usd: (r.ai_suggested_low_usd as number | null) ?? null,
        ai_suggested_high_usd: (r.ai_suggested_high_usd as number | null) ?? null,
        client_name: r.client_name as string | null,
        agent_id: r.agent_id as string,
        agent_name: agent?.name ?? null,
        agent_email: agent?.email ?? null,
        created_at: r.created_at as string,
        status: r.status as string,
        view_count: (r.view_count as number | null) ?? null,
      };
    });
  },

  async get(id: string) {
    const { data, error } = await supabase.from('appraisals').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },
};
