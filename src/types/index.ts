export type Channel = 'whatsapp' | 'instagram' | 'facebook' | 'email' | 'web' | 'zonaprop' | 'argenprop' | 'mercadolibre';
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal' | 'visit' | 'won' | 'lost';
export type Branch = 'Sucursal Centro' | 'Sucursal Norte';
export type PropertyType = 'Departamento' | 'Casa' | 'Terreno' | 'Local' | 'Oficina' | 'PH';
export type Operation = 'Venta' | 'Alquiler' | 'Alquiler Temporal';
export type Portal = 'ZonaProp' | 'Argenprop' | 'MercadoLibre' | 'Web Propia' | 'Instagram' | 'Facebook';

export interface Agent {
  id: string;
  name: string;
  email: string;
  phone: string;
  branch: Branch;
  avatar: string;
  imageUrl?: string;
  role: 'admin' | 'agent';
  stats: {
    total: number;
    active: number;
    won: number;
    lost: number;
    responseTime: string;
    conversionRate: number;
  };
}

export interface Message {
  id: string;
  direction: 'in' | 'out';
  content: string;
  timestamp: string;
  channel: Channel;
  agentId?: string;
  read: boolean;
}

export interface Lead {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
  channel: Channel;
  propertyId?: string;
  propertyTitle?: string;
  status: LeadStatus;
  assignedTo?: string;
  branch: Branch;
  createdAt: string;
  lastActivity: string;
  messages: Message[];
  notes?: string;
  tags?: string[];
  current_stage_key?: string;
  stage_changed_at?: string;
}

export interface PortalStat {
  portal: Portal;
  published: boolean;
  clicks: number;
  leads: number;
  url?: string;
}

export interface Property {
  id: string;
  title: string;
  type: PropertyType;
  operation: Operation;
  price: number;
  currency: 'USD' | 'ARS';
  address: string;
  neighborhood: string;
  branch: Branch;
  portals: PortalStat[];
  totalClicks: number;
  totalLeads: number;
  bedrooms?: number;
  bathrooms?: number;
  area: number;
  active: boolean;
  createdAt: string;
  image?: string;
}

export interface DashboardStats {
  totalLeads: number;
  newToday: number;
  pendingAssign: number;
  won: number;
  activeProperties: number;
  totalClicks: number;
  byChannel: { channel: Channel; count: number }[];
  byStatus: { status: LeadStatus; count: number }[];
  byAgent: { agentId: string; name: string; count: number; won: number }[];
}
