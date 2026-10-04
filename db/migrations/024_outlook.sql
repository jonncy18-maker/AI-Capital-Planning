-- ── 5-year outlook ───────────────────────────────────────────────────────────
-- Driver-based forward years: per-group growth assumptions, one-off planned
-- events, and scenario adjustments keyed by (year, group) rather than the
-- month x category grain of scenario_adjustments. Outlook adjustments are read
-- live by the outlook view; they are never materialized into forecast_line_items.

create table if not exists outlook_assumptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references neon_auth."user"(id) on delete cascade,
  inflation_rate numeric not null default 0.03,
  income_growth_rate numeric not null default 0.03,
  -- map of budget group name -> decimal rate; a missing key means "use inflation_rate"
  group_rates jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists outlook_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  year int not null,
  group_name text not null,
  name text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists outlook_events_user_year
  on outlook_events(user_id, year);

create table if not exists scenario_outlook_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  scenario_id uuid not null references scenarios(id) on delete cascade,
  year int not null,
  group_name text not null,
  delta_amount numeric not null,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists scenario_outlook_adjustments_user_scenario
  on scenario_outlook_adjustments(user_id, scenario_id);
