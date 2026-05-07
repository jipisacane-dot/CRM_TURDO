-- Campos extra en properties para enriquecer la ficha al cargar
alter table properties
  add column if not exists barrio text,
  add column if not exists cover_photo_url text;

-- Index para búsqueda por barrio
create index if not exists idx_properties_barrio on properties(barrio) where barrio is not null;
