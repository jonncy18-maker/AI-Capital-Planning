-- ── Import history log ───────────────────────────────────────────────────────
-- Run in Supabase SQL Editor after 002_fix_new_user_trigger.sql

create table if not exists import_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  filename       text,
  total_rows     integer not null default 0,
  inserted       integer not null default 0,
  skipped        integer not null default 0,
  unmapped_count integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists import_logs_user_date on import_logs(user_id, created_at desc);

alter table import_logs enable row level security;

create policy "users see own import_logs"
  on import_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
