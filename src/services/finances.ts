import { supabase } from './supabase';

export type FinanceScope = 'personal' | 'branch';
export type FinanceType = 'income' | 'expense';
export type Currency = 'ARS' | 'USD';
export type BranchId = 'corrientes' | 'alem';

export interface FinanceMovement {
  id: string;
  scope: FinanceScope;
  scope_id: string;
  type: FinanceType;
  category: string;
  amount_original: number;
  currency_original: Currency;
  amount_usd: number;
  blue_rate: number | null;
  description: string | null;
  movement_date: string;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

export interface BlueRate {
  compra: number;
  venta: number;
  promedio: number;
  fetched_at: string;
  source_date?: string;
  cached?: boolean;
  stale?: boolean;
}

export interface ParseFinanceResult {
  ok: boolean;
  type?: FinanceType;
  category?: string;
  amount?: number;
  currency?: Currency;
  description?: string;
  movement_date?: string;
  error?: string;
}

export const PERSONAL_CATEGORIES = [
  { value: 'comida', label: 'Comida' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'casa', label: 'Casa' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'salud', label: 'Salud' },
  { value: 'ocio', label: 'Ocio' },
  { value: 'ropa', label: 'Ropa' },
  { value: 'viajes', label: 'Viajes' },
  { value: 'cuidado_personal', label: 'Cuidado personal' },
  { value: 'regalos', label: 'Regalos' },
  { value: 'otros', label: 'Otros' },
];

export const BRANCH_EXPENSE_CATEGORIES = [
  { value: 'alquiler', label: 'Alquiler' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'sueldos', label: 'Sueldos' },
  { value: 'comisiones', label: 'Comisiones' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'papeleria', label: 'Papelería' },
  { value: 'software', label: 'Software' },
  { value: 'impuestos', label: 'Impuestos' },
  { value: 'otros', label: 'Otros' },
];

export const BRANCH_INCOME_CATEGORIES = [
  { value: 'ventas', label: 'Ventas' },
  { value: 'reservas', label: 'Reservas' },
  { value: 'tasaciones', label: 'Tasaciones' },
  { value: 'otros', label: 'Otros' },
];

export const BRANCHES: Array<{ id: BranchId; label: string }> = [
  { id: 'corrientes', label: 'Corrientes' },
  { id: 'alem', label: 'Alem' },
];

// ── Blue rate ──────────────────────────────────────────────────────────────

let _blueRateCache: { data: BlueRate; ts: number } | null = null;

export async function getBlueRate(forceFresh = false): Promise<BlueRate> {
  // Cache en memoria 5min, suficiente para una sesión de carga
  if (!forceFresh && _blueRateCache && Date.now() - _blueRateCache.ts < 5 * 60 * 1000) {
    return _blueRateCache.data;
  }
  const { data, error } = await supabase.functions.invoke('get-blue-rate', { body: {} });
  if (error) throw new Error(error.message);
  _blueRateCache = { data, ts: Date.now() };
  return data;
}

// ── Parse texto natural ────────────────────────────────────────────────────

export async function parseFinanceText(
  text: string,
  scope: FinanceScope
): Promise<ParseFinanceResult> {
  const { data, error } = await supabase.functions.invoke('parse-finance', {
    body: { text, scope },
  });
  if (error) return { ok: false, error: error.message };
  return data;
}

// ── CRUD movimientos ───────────────────────────────────────────────────────

export interface CreateMovementInput {
  scope: FinanceScope;
  scope_id: string;
  type: FinanceType;
  category: string;
  amount_original: number;
  currency_original: Currency;
  description?: string;
  movement_date?: string; // YYYY-MM-DD, default hoy
}

export async function createMovement(input: CreateMovementInput): Promise<FinanceMovement> {
  // Calcular amount_usd usando cotización blue actual
  let amount_usd = input.amount_original;
  let blue_rate: number | null = null;

  if (input.currency_original === 'ARS') {
    const blue = await getBlueRate();
    blue_rate = blue.promedio;
    amount_usd = Math.round((input.amount_original / blue.promedio) * 100) / 100;
  }

  // CRÍTICO: created_by REFERENCES agents(id), NO auth.users(id).
  // auth.getUser() devuelve el ID de auth.users — necesitamos resolver al
  // agente correspondiente vía auth_user_id antes de insertar.
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = authData?.user?.id;
  let created_by: string | null = null;
  if (authUserId) {
    const { data: agent } = await supabase
      .from('agents')
      .select('id')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    created_by = agent?.id ?? null;
  }

  const { data, error } = await supabase
    .from('finance_movements')
    .insert({
      scope: input.scope,
      scope_id: input.scope_id,
      type: input.type,
      category: input.category,
      amount_original: input.amount_original,
      currency_original: input.currency_original,
      amount_usd,
      blue_rate,
      description: input.description ?? null,
      movement_date: input.movement_date ?? new Date().toISOString().slice(0, 10),
      created_by,
    })
    .select()
    .single();

  if (error) throw error;
  return data as FinanceMovement;
}

export async function deleteMovement(id: string): Promise<void> {
  const { error } = await supabase.from('finance_movements').delete().eq('id', id);
  if (error) throw error;
}

export async function listMovements(params: {
  scope: FinanceScope;
  scope_id: string;
  monthStart: string; // YYYY-MM-01
  monthEnd: string;   // YYYY-MM-31
}): Promise<FinanceMovement[]> {
  const { data, error } = await supabase
    .from('finance_movements')
    .select('*')
    .eq('scope', params.scope)
    .eq('scope_id', params.scope_id)
    .gte('movement_date', params.monthStart)
    .lte('movement_date', params.monthEnd)
    .order('movement_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as FinanceMovement[];
}

export interface MonthlyTotals {
  income_usd: number;
  expense_usd: number;
  balance_usd: number;
  income_count: number;
  expense_count: number;
  by_category: Array<{ category: string; total_usd: number; count: number }>;
}

export function calcMonthlyTotals(movements: FinanceMovement[]): MonthlyTotals {
  let income_usd = 0;
  let expense_usd = 0;
  let income_count = 0;
  let expense_count = 0;
  const cat_totals: Record<string, { total_usd: number; count: number }> = {};

  for (const m of movements) {
    if (m.type === 'income') {
      income_usd += m.amount_usd;
      income_count++;
    } else {
      expense_usd += m.amount_usd;
      expense_count++;
    }
    const k = `${m.type}:${m.category}`;
    if (!cat_totals[k]) cat_totals[k] = { total_usd: 0, count: 0 };
    cat_totals[k].total_usd += m.amount_usd;
    cat_totals[k].count++;
  }

  const by_category = Object.entries(cat_totals)
    .map(([k, v]) => {
      const [, category] = k.split(':');
      return { category, ...v };
    })
    .sort((a, b) => b.total_usd - a.total_usd);

  return {
    income_usd: Math.round(income_usd * 100) / 100,
    expense_usd: Math.round(expense_usd * 100) / 100,
    balance_usd: Math.round((income_usd - expense_usd) * 100) / 100,
    income_count,
    expense_count,
    by_category,
  };
}

export function categoryLabel(category: string, scope: FinanceScope, type?: FinanceType): string {
  const list = scope === 'personal'
    ? PERSONAL_CATEGORIES
    : (type === 'income' ? BRANCH_INCOME_CATEGORIES : BRANCH_EXPENSE_CATEGORIES);
  return list.find(c => c.value === category)?.label ?? category;
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
