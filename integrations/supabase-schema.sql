-- ── Turdo CRM — Supabase Schema ──────────────────────────────────────────────
-- Ejecutar en Supabase → SQL Editor

-- Contactos / Leads
create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  phone         text,
  email         text,
  channel       text not null,          -- 'instagram' | 'facebook' | 'whatsapp' | 'email' | 'web'
  channel_id    text,                   -- sender_id de Meta (PSID o IG user ID)
  status        text default 'new',     -- 'new' | 'contacted' | 'qualified' | 'proposal' | 'visit' | 'won' | 'lost'
  assigned_to   text,                   -- nombre o ID del vendedor
  property_id   text,                   -- ID de Tokko si aplica
  property_title text,
  branch        text,
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Mensajes
create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid references contacts(id) on delete cascade,
  direction     text not null,          -- 'in' | 'out'
  content       text not null,
  channel       text not null,
  meta_mid      text unique,            -- message ID de Meta (para evitar duplicados)
  agent_id      text,
  read          boolean default false,
  created_at    timestamptz default now()
);

-- Índices
create index if not exists idx_messages_contact on messages(contact_id);
create index if not exists idx_messages_created on messages(created_at desc);
create index if not exists idx_contacts_channel_id on contacts(channel_id);
create index if not exists idx_contacts_status on contacts(status);
create index if not exists idx_contacts_created on contacts(created_at desc);

-- Función para actualizar updated_at automáticamente
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger contacts_updated_at
  before update on contacts
  for each row execute function update_updated_at();

-- Row Level Security (acceso público de lectura/escritura para el CRM — ajustar según necesidad)
alter table contacts enable row level security;
alter table messages enable row level security;

create policy "allow all" on contacts for all using (true) with check (true);
create policy "allow all" on messages for all using (true) with check (true);
