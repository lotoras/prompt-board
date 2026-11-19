-- More folders that are the same project (e.g. its checkout in another folder on a second PC).
alter table public.projects add column if not exists other_paths jsonb not null default '[]';
