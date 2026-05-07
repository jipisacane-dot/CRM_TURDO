import { supabase } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FunnelByAgent {
  agent_key: string;
  leads_total: number;
  leads_contactados: number;
  negociaciones_activas: number;
  ventas_aprobadas: number;
  ventas_pendientes: number;
  ventas_rechazadas: number;
}

export interface ResponseTimeRow {
  contact_id: string;
  contact_created: string;
  channel: string;
  assigned_to: string | null;
  first_out_at: string | null;
  first_responder: string | null;
  response_minutes: number | null;
}

export interface ResponseTimeStats {
  total_leads: number;
  respondidos: number;
  no_respondidos: number;
  tasa_respuesta_pct: number;
  avg_response_min: number | null;
  median_response_min: number | null;
  p90_response_min: number | null;
  by_agent: Array<{
    agent_id: string;
    agent_name: string;
    total: number;
    respondidos: number;
    avg_min: number | null;
  }>;
}

export interface ConversionByChannel {
  channel: string;
  total_leads: number;
  leads_contactados: number;
  negociaciones: number;
  ventas_cerradas: number;
  tasa_conversion_pct: number;
}

export interface ForecastSummary {
  comisiones_confirmadas_usd: number;
  forecast_pending_usd: number;
  forecast_negotiations_usd: number;
  ops_pendientes_count: number;
  negotiations_activas_count: number;
  total_estimado_usd: number;
}

export interface CaidaReason {
  reason: string;
  total: number;
  avg_days_to_caida: number;
}

export interface SaleCycleRow {
  op_id: string;
  vendedor_id: string | null;
  vendedor_name: string | null;
  fecha_boleto: string;
  contact_created_at: string | null;
  channel: string | null;
  precio_venta_usd: number;
  days_to_close: number | null;
}

export interface SaleCycleStats {
  total: number;
  avg_days: number | null;
  median_days: number | null;
  by_vendor: Array<{ vendedor_name: string; total: number; avg_days: number | null }>;
  by_channel: Array<{ channel: string; total: number; avg_days: number | null }>;
}

export interface MonthlySummaryRow {
  mes: string;
  kind: 'leads_in' | 'messages_out' | 'ventas_cerradas' | 'negociaciones_inicio' | 'negociaciones_caida';
  total_count: number;
  total_amount: number;
}

export const REASON_LABEL: Record<string, string> = {
  venta: 'Cerró en venta',
  cliente_no_quiso: 'Cliente no quiso',
  precio: 'Desacuerdo en precio',
  otro: 'Otro motivo',
  sin_motivo: 'Sin motivo declarado',
};

export const KIND_LABEL: Record<MonthlySummaryRow['kind'], string> = {
  leads_in: 'Leads ingresados',
  messages_out: 'Mensajes enviados',
  ventas_cerradas: 'Ventas cerradas',
  negociaciones_inicio: 'Negociaciones abiertas',
  negociaciones_caida: 'Negociaciones caídas',
};

// ── API ───────────────────────────────────────────────────────────────────────

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
};

const percentile = (xs: number[], p: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
};

export const analyticsApi = {
  async funnel(): Promise<FunnelByAgent[]> {
    const { data, error } = await supabase.from('v_funnel_by_agent').select('*');
    if (error) throw error;
    return (data ?? []).map(r => ({
      ...r,
      leads_total: Number(r.leads_total),
      leads_contactados: Number(r.leads_contactados),
      negociaciones_activas: Number(r.negociaciones_activas),
      ventas_aprobadas: Number(r.ventas_aprobadas),
      ventas_pendientes: Number(r.ventas_pendientes),
      ventas_rechazadas: Number(r.ventas_rechazadas),
    }));
  },

  async responseTime(): Promise<ResponseTimeStats> {
    const { data, error } = await supabase.from('v_response_time').select('*');
    if (error) throw error;
    const rows = (data ?? []) as ResponseTimeRow[];
    const total = rows.length;
    const respondidos = rows.filter(r => r.response_minutes != null);
    const noRespondidos = total - respondidos.length;
    const minutes = respondidos.map(r => Number(r.response_minutes));
    const tasa = total > 0 ? (respondidos.length / total) * 100 : 0;

    // por agente (assigned_to o first_responder)
    const byAgentMap = new Map<string, { total: number; mins: number[] }>();
    for (const r of rows) {
      const key = r.assigned_to ?? r.first_responder ?? '_sin_asignar';
      const cur = byAgentMap.get(key) ?? { total: 0, mins: [] };
      cur.total++;
      if (r.response_minutes != null) cur.mins.push(Number(r.response_minutes));
      byAgentMap.set(key, cur);
    }

    return {
      total_leads: total,
      respondidos: respondidos.length,
      no_respondidos: noRespondidos,
      tasa_respuesta_pct: Math.round(tasa * 10) / 10,
      avg_response_min: minutes.length > 0
        ? Math.round((minutes.reduce((a, b) => a + b, 0) / minutes.length) * 10) / 10
        : null,
      median_response_min: median(minutes),
      p90_response_min: percentile(minutes, 90),
      by_agent: Array.from(byAgentMap.entries()).map(([agent_id, v]) => ({
        agent_id,
        agent_name: agent_id, // se reemplaza en UI con lookup de agents
        total: v.total,
        respondidos: v.mins.length,
        avg_min: v.mins.length > 0 ? Math.round((v.mins.reduce((a, b) => a + b, 0) / v.mins.length) * 10) / 10 : null,
      })).sort((a, b) => b.total - a.total),
    };
  },

  async conversionByChannel(): Promise<ConversionByChannel[]> {
    const { data, error } = await supabase.from('v_conversion_by_channel').select('*');
    if (error) throw error;
    return (data ?? []).map(r => ({
      ...r,
      total_leads: Number(r.total_leads),
      leads_contactados: Number(r.leads_contactados),
      negociaciones: Number(r.negociaciones),
      ventas_cerradas: Number(r.ventas_cerradas),
      tasa_conversion_pct: Number(r.tasa_conversion_pct),
    }));
  },

  async forecast(): Promise<ForecastSummary> {
    const { data, error } = await supabase.from('v_forecast_summary').select('*').single();
    if (error) throw error;
    const r = data as ForecastSummary;
    const conf = Number(r.comisiones_confirmadas_usd);
    const pend = Number(r.forecast_pending_usd);
    const neg = Number(r.forecast_negotiations_usd);
    return {
      comisiones_confirmadas_usd: conf,
      forecast_pending_usd: pend,
      forecast_negotiations_usd: neg,
      ops_pendientes_count: Number(r.ops_pendientes_count),
      negotiations_activas_count: Number(r.negotiations_activas_count),
      total_estimado_usd: conf + pend + neg,
    };
  },

  async caidas(): Promise<CaidaReason[]> {
    const { data, error } = await supabase.from('v_caidas_reasons').select('*');
    if (error) throw error;
    return (data ?? []).map(r => ({
      reason: r.reason,
      total: Number(r.total),
      avg_days_to_caida: Number(r.avg_days_to_caida ?? 0),
    }));
  },

  async saleCycle(): Promise<SaleCycleStats> {
    const { data, error } = await supabase.from('v_sale_cycle').select('*');
    if (error) throw error;
    const rows = (data ?? []) as SaleCycleRow[];
    const validDays = rows.map(r => r.days_to_close).filter((d): d is number => d != null);
    const byVendor = new Map<string, { total: number; days: number[] }>();
    const byChannel = new Map<string, { total: number; days: number[] }>();
    for (const r of rows) {
      const v = r.vendedor_name ?? '—';
      const c = r.channel ?? '—';
      const cur1 = byVendor.get(v) ?? { total: 0, days: [] };
      cur1.total++;
      if (r.days_to_close != null) cur1.days.push(Number(r.days_to_close));
      byVendor.set(v, cur1);
      const cur2 = byChannel.get(c) ?? { total: 0, days: [] };
      cur2.total++;
      if (r.days_to_close != null) cur2.days.push(Number(r.days_to_close));
      byChannel.set(c, cur2);
    }
    return {
      total: rows.length,
      avg_days: validDays.length > 0 ? Math.round(validDays.reduce((a, b) => a + b, 0) / validDays.length) : null,
      median_days: median(validDays),
      by_vendor: Array.from(byVendor.entries()).map(([vendedor_name, v]) => ({
        vendedor_name,
        total: v.total,
        avg_days: v.days.length > 0 ? Math.round(v.days.reduce((a, b) => a + b, 0) / v.days.length) : null,
      })).sort((a, b) => b.total - a.total),
      by_channel: Array.from(byChannel.entries()).map(([channel, v]) => ({
        channel,
        total: v.total,
        avg_days: v.days.length > 0 ? Math.round(v.days.reduce((a, b) => a + b, 0) / v.days.length) : null,
      })).sort((a, b) => b.total - a.total),
    };
  },

  async monthlySummary(months = 6): Promise<MonthlySummaryRow[]> {
    const { data, error } = await supabase
      .from('v_monthly_summary')
      .select('*')
      .order('mes', { ascending: false })
      .limit(months * 5); // 5 kinds por mes
    if (error) throw error;
    return (data ?? []) as MonthlySummaryRow[];
  },
};
