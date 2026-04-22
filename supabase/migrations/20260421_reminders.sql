create table if not exists reminders (
  id          uuid        default gen_random_uuid() primary key,
  contact_id  uuid        references contacts(id) on delete cascade not null,
  title       text        not null,
  note        text,
  due_at      timestamptz not null,
  done        boolean     default false not null,
  agent_id    text,
  created_at  timestamptz default now() not null
);

create index if not exists reminders_due_idx     on reminders(due_at, done);
create index if not exists reminders_contact_idx on reminders(contact_id);

alter table reminders enable row level security;
create policy "reminders_all" on reminders for all using (true) with check (true);
