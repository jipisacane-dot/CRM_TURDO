import { supabase } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DBAgent {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'agent';
  base_salary_ars: number;
  branch: string | null;
  active: boolean;
  auth_user_id: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBProperty {
  id: string;
  address: string;
  description: string | null;
  rooms: number | null;
  surface_m2: number | null;
  list_price_usd: number | null;
  status: 'disponible' | 'reservada' | 'vendida' | 'archivada';
  captador_id: string | null;
  fecha_consignacion: string;
  tokko_sku: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type OperationStatus = 'reservada' | 'boleto' | 'escriturada' | 'cancelada';

export interface DBOperation {
  id: string;
  property_id: string;
  captador_id: string | null;
  vendedor_id: string;
  precio_venta_usd: number;
  fecha_boleto: string;
  fecha_escritura: string | null;
  fecha_reserva: string | null;
  monto_sena_usd: number | null;
  contact_id: string | null;
  status: OperationStatus;
  notes: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBOperationEvent {
  id: string;
  operation_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  by_agent_id: string | null;
  created_at: string;
}

export interface DBCommission {
  id: string;
  operation_id: string;
  agent_id: string;
  tipo: 'captacion' | 'venta';
  porcentaje: number;
  monto_usd: number;
  mes_liquidacion: string;
  paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  active: boolean;
  created_at: string;
}

export interface DBPayrollRun {
  id: string;
  agent_id: string;
  mes_liquidacion: string;
  base_salary_ars: number;
  commissions_total_usd: number;
  exchange_rate: number | null;
  commissions_total_ars: number | null;
  total_ars: number;
  status: 'pendiente' | 'pagado';
  paid_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface OperationWithRefs extends DBOperation {
  property: DBProperty | null;
  vendedor: DBAgent | null;
  captador: DBAgent | null;
  contact: ContactLite | null;
}

export interface CommissionWithRefs extends DBCommission {
  agent: DBAgent | null;
  operation: (DBOperation & { property: DBProperty | null }) | null;
}

// ── Agents ───────────────────────────────────────────────────────────────────

export const agentsApi = {
  async list(): Promise<DBAgent[]> {
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('active', true)
      .order('role')
      .order('name');
    if (error) throw error;
    return data ?? [];
  },
  async update(id: string, fields: Partial<DBAgent>): Promise<void> {
    const { error } = await supabase.from('agents').update(fields).eq('id', id);
    if (error) throw error;
  },
};

// ── Properties ───────────────────────────────────────────────────────────────

export const propertiesApi = {
  async list(): Promise<DBProperty[]> {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  async create(p: Omit<DBProperty, 'id' | 'created_at' | 'updated_at'>): Promise<DBProperty> {
    const { data, error } = await supabase.from('properties').insert(p).select().single();
    if (error) throw error;
    return data;
  },
  async update(id: string, fields: Partial<DBProperty>): Promise<void> {
    const { error } = await supabase.from('properties').update(fields).eq('id', id);
    if (error) throw error;
  },
};

// ── Operations ───────────────────────────────────────────────────────────────

export const operationsApi = {
  async listWithRefs(): Promise<OperationWithRefs[]> {
    const { data, error } = await supabase
      .from('operations')
      .select(`
        *,
        property:properties(*),
        vendedor:agents!operations_vendedor_id_fkey(*),
        captador:agents!operations_captador_id_fkey(*),
        contact:contacts(id, name, phone, email, channel, status, notes)
      `)
      .order('fecha_boleto', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as OperationWithRefs[];
  },
  async create(op: Omit<DBOperation, 'id' | 'created_at' | 'updated_at'>): Promise<DBOperation> {
    const { data, error } = await supabase.from('operations').insert(op).select().single();
    if (error) throw error;
    return data;
  },
  async update(id: string, fields: Partial<DBOperation>): Promise<void> {
    const { error } = await supabase.from('operations').update(fields).eq('id', id);
    if (error) throw error;
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('operations').delete().eq('id', id);
    if (error) throw error;
  },
  async events(operationId: string): Promise<DBOperationEvent[]> {
    const { data, error } = await supabase
      .from('operation_events')
      .select('*')
      .eq('operation_id', operationId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
};

// ── Pipeline summary ─────────────────────────────────────────────────────────

export interface PipelineSummary {
  status: OperationStatus;
  total: number;
  volumen_usd: number;
}

export const pipelineApi = {
  async summary(): Promise<PipelineSummary[]> {
    const { data, error } = await supabase
      .from('v_pipeline_summary')
      .select('*');
    if (error) throw error;
    return (data ?? []) as PipelineSummary[];
  },
};

// ── Advances (adelantos de comisión) ─────────────────────────────────────────

export type AdvanceStatus = 'pendiente' | 'aprobado' | 'rechazado' | 'liquidado';

export interface DBAdvance {
  id: string;
  agent_id: string;
  amount_usd: number;
  amount_ars: number | null;
  exchange_rate: number | null;
  reason: string | null;
  status: AdvanceStatus;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_note: string | null;
  applied_to_month: string | null;
  created_at: string;
}

export interface AdvanceWithAgent extends DBAdvance {
  agent: DBAgent | null;
}

export const advancesApi = {
  async list(): Promise<AdvanceWithAgent[]> {
    const { data, error } = await supabase
      .from('commission_advances')
      .select(`*, agent:agents!commission_advances_agent_id_fkey(*)`)
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as AdvanceWithAgent[];
  },
  async listForAgent(agentId: string): Promise<AdvanceWithAgent[]> {
    const { data, error } = await supabase
      .from('commission_advances')
      .select(`*, agent:agents!commission_advances_agent_id_fkey(*)`)
      .eq('agent_id', agentId)
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as AdvanceWithAgent[];
  },
  async listForMonth(yearMonth: string): Promise<AdvanceWithAgent[]> {
    const start = `${yearMonth}-01`;
    const [y, m] = yearMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from('commission_advances')
      .select(`*, agent:agents!commission_advances_agent_id_fkey(*)`)
      .gte('applied_to_month', start)
      .lte('applied_to_month', end)
      .in('status', ['aprobado', 'liquidado'])
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as AdvanceWithAgent[];
  },
  async create(p: { agent_id: string; amount_usd: number; reason?: string }): Promise<DBAdvance> {
    const { data, error } = await supabase
      .from('commission_advances')
      .insert({ ...p, status: 'pendiente' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async resolve(id: string, status: 'aprobado' | 'rechazado', opts: {
    resolvedBy?: string | null;
    note?: string;
    appliedToMonth?: string;
    exchangeRate?: number;
  }): Promise<void> {
    const update: Partial<DBAdvance> & { resolved_at: string } = {
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: opts.resolvedBy ?? null,
      resolved_note: opts.note ?? null,
    };
    if (status === 'aprobado') {
      update.applied_to_month = opts.appliedToMonth ?? null;
      update.exchange_rate = opts.exchangeRate ?? null;
    }
    const { error } = await supabase.from('commission_advances').update(update).eq('id', id);
    if (error) throw error;
  },
};

// ── Expenses (gastos / pagos a proveedores) ──────────────────────────────────

export const EXPENSE_CATEGORIES = [
  { key: 'marketing', label: 'Marketing y publicidad' },
  { key: 'fotografia', label: 'Fotografía / video' },
  { key: 'escribano', label: 'Escribano / honorarios' },
  { key: 'mantenimiento', label: 'Mantenimiento / refacciones' },
  { key: 'oficina', label: 'Oficina / servicios' },
  { key: 'sueldo', label: 'Sueldos' },
  { key: 'comision', label: 'Comisiones pagadas' },
  { key: 'impuestos', label: 'Impuestos / retenciones' },
  { key: 'otro', label: 'Otro' },
] as const;

export interface DBExpense {
  id: string;
  fecha: string;
  category: string;
  description: string;
  amount_ars: number;
  payment_method: string | null;
  paid_to: string | null;
  related_operation_id: string | null;
  related_property_id: string | null;
  receipt_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export const expensesApi = {
  async list(): Promise<DBExpense[]> {
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .order('fecha', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  async listForMonth(yearMonth: string): Promise<DBExpense[]> {
    const start = `${yearMonth}-01`;
    const [y, m] = yearMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .gte('fecha', start)
      .lte('fecha', end)
      .order('fecha', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  async create(e: Omit<DBExpense, 'id' | 'created_at'>): Promise<DBExpense> {
    const { data, error } = await supabase.from('expenses').insert(e).select().single();
    if (error) throw error;
    return data;
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) throw error;
  },
};

// ── Cashflow ─────────────────────────────────────────────────────────────────

export interface CashflowMonthly {
  mes: string;
  kind: 'income' | 'expense';
  category: string;
  movs: number;
  total_ars: number;
}

export const cashflowApi = {
  async monthly(): Promise<CashflowMonthly[]> {
    const { data, error } = await supabase
      .from('v_cashflow_monthly')
      .select('*');
    if (error) throw error;
    return (data ?? []) as CashflowMonthly[];
  },
};

// ── Expirations ──────────────────────────────────────────────────────────────

export interface DBExpiration {
  id: string;
  type: string;
  title: string;
  description: string | null;
  due_date: string;
  notify_days_before: number;
  related_id: string | null;
  related_type: string | null;
  notified: boolean;
  notified_at: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export const EXPIRATION_TYPE_LABEL: Record<string, string> = {
  escritura: 'Escritura',
  contrato: 'Contrato',
  seguro: 'Seguro',
  habilitacion: 'Habilitación',
  cumpleanos: 'Cumpleaños',
  aniversario: 'Aniversario',
  otro: 'Otro',
};

export const expirationsApi = {
  async listPending(): Promise<DBExpiration[]> {
    const { data, error } = await supabase
      .from('expirations')
      .select('*')
      .eq('resolved', false)
      .order('due_date', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
  async listAll(): Promise<DBExpiration[]> {
    const { data, error } = await supabase
      .from('expirations')
      .select('*')
      .order('due_date', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
  async create(e: Partial<DBExpiration> & { type: string; title: string; due_date: string }): Promise<DBExpiration> {
    const { data, error } = await supabase.from('expirations').insert(e).select().single();
    if (error) throw error;
    return data;
  },
  async resolve(id: string, by?: string | null): Promise<void> {
    const { error } = await supabase.from('expirations').update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: by ?? null,
    }).eq('id', id);
    if (error) throw error;
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('expirations').delete().eq('id', id);
    if (error) throw error;
  },
};

// ── Contacts (lite, para vincular como comprador en operaciones) ────────────

export interface ContactLite {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  channel: string;
  status: string;
  notes: string | null;
}

export const contactsLiteApi = {
  async list(): Promise<ContactLite[]> {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, name, phone, email, channel, status, notes')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return data ?? [];
  },
};

// ── Documents ────────────────────────────────────────────────────────────────

export const DOC_CATEGORIES = [
  { key: 'boleto', label: 'Boleto de compraventa' },
  { key: 'escritura', label: 'Escritura' },
  { key: 'sena', label: 'Comprobante de seña' },
  { key: 'tasacion', label: 'Tasación' },
  { key: 'autorizacion', label: 'Autorización de venta' },
  { key: 'plano', label: 'Plano' },
  { key: 'foto', label: 'Foto' },
  { key: 'otro', label: 'Otro' },
] as const;

export interface DBDocument {
  id: string;
  operation_id: string | null;
  property_id: string | null;
  category: string;
  title: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  file_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export const documentsApi = {
  async listForOperation(operationId: string): Promise<DBDocument[]> {
    const { data, error } = await supabase
      .from('operation_documents')
      .select('*')
      .eq('operation_id', operationId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  async upload(opts: {
    operationId?: string;
    propertyId?: string;
    file: File;
    category: string;
    title: string;
    uploadedBy?: string | null;
  }): Promise<DBDocument> {
    const folder = opts.operationId ? `operations/${opts.operationId}` : `properties/${opts.propertyId}`;
    const cleanName = opts.file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const filePath = `${folder}/${Date.now()}_${cleanName}`;
    const { error: upErr } = await supabase.storage
      .from('operation-docs')
      .upload(filePath, opts.file, { cacheControl: '3600', upsert: false });
    if (upErr) throw upErr;

    const { data, error } = await supabase.from('operation_documents').insert({
      operation_id: opts.operationId ?? null,
      property_id: opts.propertyId ?? null,
      category: opts.category,
      title: opts.title,
      file_path: filePath,
      file_name: opts.file.name,
      file_size: opts.file.size,
      file_type: opts.file.type,
      uploaded_by: opts.uploadedBy ?? null,
    }).select().single();
    if (error) throw error;
    return data;
  },
  async getPublicUrl(filePath: string): Promise<string> {
    const { data } = supabase.storage.from('operation-docs').getPublicUrl(filePath);
    return data.publicUrl;
  },
  async remove(doc: DBDocument): Promise<void> {
    await supabase.storage.from('operation-docs').remove([doc.file_path]);
    const { error } = await supabase.from('operation_documents').delete().eq('id', doc.id);
    if (error) throw error;
  },
};

// ── Commissions ──────────────────────────────────────────────────────────────

export const commissionsApi = {
  async listForMonth(yearMonth: string /* YYYY-MM */): Promise<CommissionWithRefs[]> {
    const start = `${yearMonth}-01`;
    const [y, m] = yearMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from('commissions')
      .select(`
        *,
        agent:agents!commissions_agent_id_fkey(*),
        operation:operations(*, property:properties(*))
      `)
      .eq('active', true)
      .gte('mes_liquidacion', start)
      .lte('mes_liquidacion', end)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as CommissionWithRefs[];
  },
  async listForAgent(agentId: string): Promise<CommissionWithRefs[]> {
    const { data, error } = await supabase
      .from('commissions')
      .select(`
        *,
        agent:agents!commissions_agent_id_fkey(*),
        operation:operations(*, property:properties(*))
      `)
      .eq('agent_id', agentId)
      .eq('active', true)
      .order('mes_liquidacion', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as CommissionWithRefs[];
  },
  async markPaid(ids: string[], paidBy: string | null): Promise<void> {
    const { error } = await supabase
      .from('commissions')
      .update({ paid: true, paid_at: new Date().toISOString(), paid_by: paidBy })
      .in('id', ids);
    if (error) throw error;
  },
  async markUnpaid(ids: string[]): Promise<void> {
    const { error } = await supabase
      .from('commissions')
      .update({ paid: false, paid_at: null, paid_by: null })
      .in('id', ids);
    if (error) throw error;
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export const fmtUSD = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export const fmtARS = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

export const fmtDate = (d: string) =>
  new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const monthLabel = (yearMonth: string) => {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
};

export const currentYearMonth = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
