create table if not exists push_subscriptions (
  id          uuid        default gen_random_uuid() primary key,
  agent_id    text        not null,
  endpoint    text        not null unique,
  p256dh      text        not null,
  auth        text        not null,
  created_at  timestamptz default now() not null
);

alter table push_subscriptions enable row level security;
create policy "push_all" on push_subscriptions for all using (true) with check (true);
