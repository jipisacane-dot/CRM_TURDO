-- =========================================================================
-- Documentos adjuntos por operación / propiedad
-- =========================================================================

-- Bucket de Storage para documentos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'operation-docs',
  'operation-docs',
  true,
  20971520, -- 20MB
  array['image/png','image/jpeg','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do nothing;

-- Policies del bucket — abiertas por ahora (alineado con resto del CRM)
drop policy if exists "operation_docs_read" on storage.objects;
create policy "operation_docs_read" on storage.objects
  for select using (bucket_id = 'operation-docs');

drop policy if exists "operation_docs_insert" on storage.objects;
create policy "operation_docs_insert" on storage.objects
  for insert with check (bucket_id = 'operation-docs');

drop policy if exists "operation_docs_update" on storage.objects;
create policy "operation_docs_update" on storage.objects
  for update using (bucket_id = 'operation-docs');

drop policy if exists "operation_docs_delete" on storage.objects;
create policy "operation_docs_delete" on storage.objects
  for delete using (bucket_id = 'operation-docs');

-- Tabla con metadata de documentos (categoría + relación a operation/property)
create table if not exists operation_documents (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid references operations(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  category text not null,  -- 'boleto', 'escritura', 'sena', 'tasacion', 'autorizacion', 'plano', 'otro'
  title text not null,
  file_path text not null,         -- path dentro del bucket: operations/{op_id}/...
  file_name text not null,
  file_size bigint,
  file_type text,
  uploaded_by uuid references agents(id),
  created_at timestamptz default now()
);

create index if not exists idx_op_docs_op on operation_documents(operation_id, created_at desc);
create index if not exists idx_op_docs_prop on operation_documents(property_id, created_at desc);

alter table operation_documents enable row level security;
drop policy if exists "op_docs_all" on operation_documents;
create policy "op_docs_all" on operation_documents for all using (true) with check (true);
