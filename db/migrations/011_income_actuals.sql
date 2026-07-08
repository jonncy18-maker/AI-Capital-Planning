-- 011_income_actuals.sql
-- Simplify cash inflow to a single per-month series: Income = Cash inflow.
-- Historical months are pulled from transactions; forecast months are derived
-- from the salary/bonus assumptions in Settings (user_profiles). The manual
-- income_sources / income_amounts model (010) is replaced by a single
-- per-month actuals table that stores pulled or manually-adjusted inflow.

drop table if exists income_amounts;
drop table if exists income_sources;

create table if not exists income_actuals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  year       integer not null,
  month      integer not null check (month between 1 and 12),
  amount     numeric not null,
  source     text not null default 'manual',   -- 'pulled' (from transactions) | 'manual'
  notes      text,
  created_at timestamptz not null default now(),
  unique (user_id, year, month)
);

create index if not exists income_actuals_user on income_actuals(user_id, year, month);

alter table income_actuals enable row level security;
create policy "users see own income_actuals"
  on income_actuals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
