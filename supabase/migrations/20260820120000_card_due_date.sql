-- Optional per-card due date (local calendar date, no time component).
alter table public.cards add column if not exists due_date date;
