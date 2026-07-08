-- 010_income.sql
-- Cash inflow: recurring income sources (salary, bonus, …) plus monthly actuals
-- for reconciliation. Mirrors the bills / bill_amounts pattern used for outflow,
-- so the Pay Period Planner can compare inflow vs. outflow across the year.

create table if not exists income_sources (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  income_type   text not null default 'salary',   -- salary | bonus | other
  cadence       text not null default 'monthly',   -- monthly | annual
  amount        numeric,                            -- expected net amount; null = variable
  month         integer check (month is null or month between 1 and 12),  -- pay month when cadence = 'annual'
  active        boolean not null default true,
  display_order integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists income_sources_user on income_sources(user_id, display_order);

alter table income_sources enable row level security;
create policy "users see own income_sources"
  on income_sources for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists income_amounts (
  id                uuid primary key default gen_random_uuid(),
  income_source_id  uuid not null references income_sources(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  year              integer not null,
  month             integer not null check (month between 1 and 12),
  amount            numeric not null,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (income_source_id, year, month)
);

create index if not exists income_amounts_user on income_amounts(user_id, year, month);
create index if not exists income_amounts_source on income_amounts(income_source_id);

alter table income_amounts enable row level security;
create policy "users see own income_amounts"
  on income_amounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
