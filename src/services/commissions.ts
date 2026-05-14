import { supabase } from './supabase';

// ── In-memory cache with TTL + dedup de in-flight requests ─────────────────
// Para listas compartidas que múltiples páginas piden simultáneamente.
// Evita 5 round trips paralelos cuando el user cambia de página rápido.
type CacheEntry<T> = { data: T; ts: number };
const CACHE_TTL_MS = 30_000; // 30s — fresh enough para no quedar atrás
const _cache = new Map<string, CacheEntry<unknown>>();
const _inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  const flying = _inflight.get(key) as Promise<T> | undefined;
  if (flying) return flying;
  const p = loader().then(data => {
    _cache.set(key, { data, ts: Date.now() });
    _inflight.delete(key);
    return data;
  }).catch(e => {
    _inflight.delete(key);
    throw e;
  });
  _inflight.set(key, p);
  return p;
}

/** Invalidar manualmente cuando creamos/editamos algo, para forzar refetch */
export function invalidateCache(prefix?: string) {
  if (!prefix) {
    _cache.clear();
    return;
  }
  for (const k of Array.from(_cache.keys())) {
    if (k.startsWith(prefix)) _cache.delete(k);
  }
}

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
  barrio: string | null;
  cover_photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export type OperationStatus = 'reservada' | 'boleto' | 'escriturada' | 'cancelada';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface DBOperation {
  id: string;
  property_id: string;
  captador_id: string | null;
  vendedor_id: string;
  precio_venta_usd: number;
  fecha_boleto: string;
  fecha_escritura: string | null;
  fecha_reserva: string | null;
  fecha_vencimiento_reserva: string | null;
  monto_sena_usd: number | null;
  contact_id: string | null;
  status: OperationStatus;
  notes: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  paid_at: string | null;
  agency_commission_pct: number;
  // ── Datos del propietario (dueño que vende) ─────────────────
  propietario_nombre: string | null;
  propietario_telefono: string | null;
  // ── Comisión compartida con otra inmobiliaria ──────────────
  is_compartida: boolean;
  inmobiliaria_compartida_nombre: string | null;
  comision_pct_turdo: number; // 6 default, 3 si compartida (editable)
  // ── Honorarios calculados / editables por Leti ─────────────
  honorarios_totales_usd: number | null;
  honorarios_vendedor_usd: number | null;
  honorarios_captador_usd: number | null;
  comision_captador_pct: number; // % del total que cobra captador (cuando ≠ vendedor)
  // ── Escribanía y gastos ────────────────────────────────────
  escribania_nombre: string | null;
  monto_escrituracion_usd: number | null;
  gastos_escribania_comprador_usd: number | null;
  gastos_escribania_vendedor_usd: number | null;
  tasador: string | null;
  cedula_estado: string | null;
  // ── Servicios y trámites ───────────────────────────────────
  osse: string | null;
  arba: string | null;
  arm: string | null;
  camuzzi: string | null;
  edea: string | null;
  administracion: string | null;
  observaciones_extra: string | null;
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
  porcentaje: number;            // % escalonado (20/25/30)
  nivel_escalonado: number | null;
  agency_commission_pct: number; // 6 por default (lo que cobra Turdo)
  comision_total_usd: number;    // precio × agency_pct/100
  monto_usd: number;             // comision_total × porcentaje/100 (lo que cobra el vendedor)
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
    return cached('agents:list', async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('active', true)
        .order('role')
        .order('name');
      if (error) throw error;
      return data ?? [];
    });
  },
  async update(id: string, fields: Partial<DBAgent>): Promise<void> {
    const { error } = await supabase.from('agents').update(fields).eq('id', id);
    if (error) throw error;
    invalidateCache('agents:');
  },
};

// ── Properties ───────────────────────────────────────────────────────────────

export const propertiesApi = {
  async list(): Promise<DBProperty[]> {
    return cached('properties:list', async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    });
  },
  async create(p: Omit<DBProperty, 'id' | 'created_at' | 'updated_at'>): Promise<DBProperty> {
    const { data, error } = await supabase.from('properties').insert(p).select().single();
    if (error) throw error;
    invalidateCache('properties:');
    return data;
  },
  async update(id: string, fields: Partial<DBProperty>): Promise<void> {
    const { error } = await supabase.from('properties').update(fields).eq('id', id);
    if (error) throw error;
    invalidateCache('properties:');
  },
  async uploadCoverPhoto(propertyId: string, file: File): Promise<string> {
    const cleanName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const filePath = `${propertyId}/cover_${Date.now()}_${cleanName}`;
    const { error: upErr } = await supabase.storage
      .from('property-photos')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from('property-photos').getPublicUrl(filePath);
    const url = data.publicUrl;
    const { error } = await supabase.from('properties').update({ cover_photo_url: url }).eq('id', propertyId);
    if (error) throw error;
    return url;
  },
};

// ── Operations ───────────────────────────────────────────────────────────────

export const operationsApi = {
  async listWithRefs(opts?: { vendedorId?: string }): Promise<OperationWithRefs[]> {
    const key = `operations:listWithRefs:${opts?.vendedorId ?? 'all'}`;
    return cached(key, async () => {
      let query = supabase
        .from('operations')
        .select(`
          *,
          property:properties(*),
          vendedor:agents!operations_vendedor_id_fkey(*),
          captador:agents!operations_captador_id_fkey(*),
          contact:contacts(id, name, phone, email, channel, status, notes)
        `)
        .order('fecha_boleto', { ascending: false });
      if (opts?.vendedorId) {
        query = query.eq('vendedor_id', opts.vendedorId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as OperationWithRefs[];
    });
  },
  async create(op: Omit<DBOperation, 'id' | 'created_at' | 'updated_at'>): Promise<DBOperation> {
    const { data, error } = await supabase.from('operations').insert(op).select().single();
    if (error) throw error;
    invalidateCache('operations:');
    invalidateCache('properties:');
    return data;
  },
  async update(id: string, fields: Partial<DBOperation>): Promise<void> {
    const { error } = await supabase.from('operations').update(fields).eq('id', id);
    if (error) throw error;
    invalidateCache('operations:');
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('operations').delete().eq('id', id);
    if (error) throw error;
    invalidateCache('operations:');
  },
  async approve(id: string, approvedBy: string | null): Promise<void> {
    const { error } = await supabase.from('operations').update({
      approval_status: 'approved',
      approved_by: approvedBy,
      rejected_reason: null,
    }).eq('id', id);
    if (error) throw error;
    invalidateCache('operations:');
  },
  async reject(id: string, reason: string, approvedBy: string | null): Promise<void> {
    const { error } = await supabase.from('operations').update({
      approval_status: 'rejected',
      approved_by: approvedBy,
      rejected_reason: reason,
    }).eq('id', id);
    if (error) throw error;
    invalidateCache('operations:');
  },
  async markPaid(id: string): Promise<void> {
    const { error } = await supabase.from('operations').update({
      paid_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
    invalidateCache('operations:');
  },
  async markUnpaid(id: string): Promise<void> {
    const { error } = await supabase.from('operations').update({
      paid_at: null,
    }).eq('id', id);
    if (error) throw error;
    invalidateCache('operations:');
  },
  async listPendingApproval(): Promise<PendingApprovalRow[]> {
    return cached('operations:pendingApproval', async () => {
      const { data, error } = await supabase
        .from('v_operations_pending_approval')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PendingApprovalRow[];
    });
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

export interface PendingApprovalRow {
  id: string;
  property_id: string;
  property_address: string | null;
  vendedor_id: string;
  vendedor_name: string | null;
  precio_venta_usd: number;
  agency_commission_pct: number;
  fecha_boleto: string;
  status: OperationStatus;
  notes: string | null;
  created_at: string;
  orden_estimado: number;
}

export const pipelineApi = {
  async summary(): Promise<PipelineSummary[]> {
    return cached('pipeline:summary', async () => {
      const { data, error } = await supabase
        .from('v_pipeline_summary')
        .select('*');
      if (error) throw error;
      return (data ?? []) as PipelineSummary[];
    });
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
    return cached('contactsLite:list', async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, phone, email, channel, status, notes')
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    });
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
    const { data, error } = await supabase.storage
      .from('operation-docs')
      .createSignedUrl(filePath, 3600);
    if (error) throw error;
    return data.signedUrl;
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
  /**
   * Marca pagado en operations.paid_at (fuente de verdad).
   * Un trigger en DB sincroniza commissions.paid automaticamente.
   */
  async markPaid(ids: string[], paidBy: string | null): Promise<void> {
    // Obtener operation_ids
    const { data: rows, error: e1 } = await supabase
      .from('commissions')
      .select('operation_id')
      .in('id', ids);
    if (e1) throw e1;
    const opIds = Array.from(new Set((rows ?? []).map(r => r.operation_id)));
    if (opIds.length === 0) return;
    const { error } = await supabase
      .from('operations')
      .update({ paid_at: new Date().toISOString() })
      .in('id', opIds);
    if (error) throw error;
    // Actualizar paid_by aparte (no esta en operations)
    const { error: e2 } = await supabase
      .from('commissions')
      .update({ paid_by: paidBy })
      .in('id', ids);
    if (e2) throw e2;
  },
  async markUnpaid(ids: string[]): Promise<void> {
    const { data: rows, error: e1 } = await supabase
      .from('commissions')
      .select('operation_id')
      .in('id', ids);
    if (e1) throw e1;
    const opIds = Array.from(new Set((rows ?? []).map(r => r.operation_id)));
    if (opIds.length === 0) return;
    const { error } = await supabase
      .from('operations')
      .update({ paid_at: null })
      .in('id', opIds);
    if (error) throw error;
    await supabase
      .from('commissions')
      .update({ paid_by: null })
      .in('id', ids);
  },
};

// ── Property Negotiations (vendedor marca "estoy negociando") ─────────────────

export type NegotiationStatus = 'activa' | 'cerrada' | 'caida';

export interface DBNegotiation {
  id: string;
  property_id: string;
  agent_id: string;
  contact_id: string | null;
  notes: string | null;
  status: NegotiationStatus;
  closed_at: string | null;
  closed_reason: string | null;
  operation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NegotiationWithRefs extends DBNegotiation {
  property: DBProperty | null;
  agent: DBAgent | null;
  contact: ContactLite | null;
}

export const negotiationsApi = {
  async listActive(): Promise<NegotiationWithRefs[]> {
    const { data, error } = await supabase
      .from('property_negotiations')
      .select(`
        *,
        property:properties(*),
        agent:agents!property_negotiations_agent_id_fkey(*),
        contact:contacts(id, name, phone, email, channel, status, notes)
      `)
      .eq('status', 'activa')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as NegotiationWithRefs[];
  },
  async listForAgent(agentId: string): Promise<NegotiationWithRefs[]> {
    const { data, error } = await supabase
      .from('property_negotiations')
      .select(`
        *,
        property:properties(*),
        agent:agents!property_negotiations_agent_id_fkey(*),
        contact:contacts(id, name, phone, email, channel, status, notes)
      `)
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as NegotiationWithRefs[];
  },
  async create(p: { property_id: string; agent_id: string; contact_id?: string | null; notes?: string }): Promise<DBNegotiation> {
    const { data, error } = await supabase
      .from('property_negotiations')
      .insert({
        property_id: p.property_id,
        agent_id: p.agent_id,
        contact_id: p.contact_id ?? null,
        notes: p.notes ?? null,
        status: 'activa',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async close(id: string, opts: { reason: 'venta' | 'cliente_no_quiso' | 'precio' | 'otro'; operation_id?: string | null; notes?: string }): Promise<void> {
    const { error } = await supabase.from('property_negotiations').update({
      status: opts.reason === 'venta' ? 'cerrada' : 'caida',
      closed_at: new Date().toISOString(),
      closed_reason: opts.reason,
      operation_id: opts.operation_id ?? null,
      notes: opts.notes ?? undefined,
    }).eq('id', id);
    if (error) throw error;
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('property_negotiations').delete().eq('id', id);
    if (error) throw error;
  },
};

// ── Helpers de comisión ──────────────────────────────────────────────────────

export const escalonadoPctForOrden = (orden: number): number => {
  if (orden <= 1) return 20;
  if (orden === 2) return 25;
  return 30;
};

/** Preview de comisión sin tocar DB (para mostrar en form mientras carga) */
export const previewComisionAgente = (
  precio_venta_usd: number,
  ordenEstimado: number,
  agency_pct: number = 6,
): { turdo_usd: number; agente_usd: number; pct_escalonado: number } => {
  const pct = escalonadoPctForOrden(ordenEstimado);
  const turdo = Math.round(precio_venta_usd * agency_pct / 100 * 100) / 100;
  const agente = Math.round(turdo * pct / 100 * 100) / 100;
  return { turdo_usd: turdo, agente_usd: agente, pct_escalonado: pct };
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
