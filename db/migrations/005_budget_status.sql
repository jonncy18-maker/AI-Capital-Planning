-- ── budget_status ─────────────────────────────────────────────────────────────
-- Tracks the lifecycle of a year's budget: 'draft' (freely editable) vs.
-- 'finalized' (locked; must be explicitly reopened before editing). A finalized
-- budget is the source of truth historical trends are measured against, so
-- reopening is gated behind an explicit confirmation in the UI.

create table if not exists budget_status (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  budget_year     integer not null,
  budget_version  text not null default 'v1',
  status          text not null default 'draft' check (status in ('draft', 'finalized')),
  finalized_at    timestamptz,
  updated_at      timestamptz not null default now(),
  unique (user_id, budget_year, budget_version)
);

create index if not exists budget_status_user_year on budget_status(user_id, budget_year);

alter table budget_status enable row level security;
create policy "users see own budget_status"
  on budget_status for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
