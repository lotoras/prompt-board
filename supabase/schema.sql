-- prompt-board sync schema.
-- Run this in the Supabase SQL editor of your project, then enable Realtime
-- for both tables (Database > Replication) and create one auth user
-- (email + password) to sign into the app with.

create table public.projects (
  user_id     uuid not null default auth.uid() references auth.users,
  project_key text not null,
  name        text not null,
  base_path   text not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  device_id   text not null,
  primary key (user_id, project_key)
);

create table public.cards (
  user_id     uuid not null default auth.uid() references auth.users,
  id          text not null,
  project_key text not null,
  column_id   text not null,
  title       text not null,
  body        text not null default '',
  tags        jsonb not null default '[]',
  "order"     text not null,
  link        text,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  device_id   text not null,
  primary key (user_id, id)
);

-- Row Level Security: each user only ever sees/writes their own rows.
alter table public.projects enable row level security;
alter table public.cards enable row level security;

create policy own_projects on public.projects for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_cards on public.cards for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Indexes for the incremental "updated since lastPulledAt" pull query.
create index cards_updated on public.cards (user_id, updated_at);
create index projects_updated on public.projects (user_id, updated_at);

-- Realtime: after running this migration, enable Realtime for both
-- `projects` and `cards` in the Supabase dashboard (Database > Replication).
-- The sync engine subscribes to postgres_changes on both tables and filters
-- out its own device_id to avoid echoing local writes back to itself.
