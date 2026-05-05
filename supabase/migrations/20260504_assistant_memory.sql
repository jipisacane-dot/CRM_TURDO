-- Memoria persistente del asistente IA
-- Permite que Claude guarde hechos relevantes y los recuerde entre conversaciones.
-- Cada memoria pertenece a un user_email (por ahora solo Leti, pero escala a vendedores).

create table if not exists assistant_memories (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  category text not null default 'general',  -- general, preference, team, business, deadline
  content text not null,
  importance int not null default 3 check (importance between 1 and 5),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_memories_user on assistant_memories(user_email);
create index if not exists idx_memories_user_importance on assistant_memories(user_email, importance desc);

alter table assistant_memories enable row level security;
drop policy if exists "memories_all" on assistant_memories;
create policy "memories_all" on assistant_memories for all using (true) with check (true);
