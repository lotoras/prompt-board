-- prompt-board sync schema.

create table if not exists public.projects (
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

create table if not exists public.cards (
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

drop policy if exists own_projects on public.projects;
create policy own_projects on public.projects for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_cards on public.cards;
create policy own_cards on public.cards for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Indexes for the incremental "updated since lastPulledAt" pull query.
create index if not exists cards_updated on public.cards (user_id, updated_at);
create index if not exists projects_updated on public.projects (user_id, updated_at);

-- Realtime: the sync engine subscribes to postgres_changes on both tables
-- and filters out its own device_id to avoid echoing local writes back to itself.
do $$
begin
  alter publication supabase_realtime add table public.projects;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.cards;
exception
  when duplicate_object then null;
end $$;
