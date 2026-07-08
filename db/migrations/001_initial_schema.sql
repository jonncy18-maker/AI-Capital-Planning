-- ── AI Capital Planning — Initial Schema ─────────────────────────────────────
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Requires the pgcrypto extension (enabled by default on all Supabase projects).

-- ── transactions ─────────────────────────────────────────────────────────────

create table if not exists transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  date                date not null,
  merchant            text not null,
  category            text,
  "group"             text,
  account             text,
  amount              numeric not null,
  original_statement  text,
  notes               text,
  owner               text,
  import_source       text,
  -- dedup_key = date|merchant_lower|amount|account — enforced per user
  dedup_key           text not null,
  created_at          timestamptz not null default now(),
  unique(user_id, dedup_key)
);

create index if not exists transactions_user_date on transactions(user_id, date desc);
create index if not exists transactions_user_category on transactions(user_id, category);

alter table transactions enable row level security;
create policy "users see own transactions"
  on transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── budget_categories ─────────────────────────────────────────────────────────

create table if not exists budget_categories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  category        text not null,
  "group"         text,
  type            text check (type in ('Fixed', 'Flexible', 'Non-Monthly')),
  monthly_target  numeric,
  annual_target   numeric,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique(user_id, category)
);

alter table budget_categories enable row level security;
create policy "users see own budget_categories"
  on budget_categories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── commitments ──────────────────────────────────────────────────────────────

create table if not exists commitments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  type            text check (type in ('scholarship', 'family_support', 'lease', 'eldercare', 'other')),
  start_date      date not null,
  end_date        date,
  status          text not null default 'active' check (status in ('active', 'paused', 'completed')),
  cost_structure  jsonb not null default '{}',
  split_rules     jsonb not null default '{}',
  notes           text,
  created_at      timestamptz not null default now()
);

alter table commitments enable row level security;
create policy "users see own commitments"
  on commitments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── budget_line_items ─────────────────────────────────────────────────────────

create table if not exists budget_line_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  budget_year     integer not null,
  budget_version  text not null default 'v1',
  category_id     uuid not null references budget_categories(id) on delete cascade,
  month           integer not null check (month between 1 and 12),
  amount          numeric not null,
  label           text,
  commitment_id   uuid references commitments(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists budget_line_items_user_year on budget_line_items(user_id, budget_year, month);

alter table budget_line_items enable row level security;
create policy "users see own budget_line_items"
  on budget_line_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── scenarios ────────────────────────────────────────────────────────────────

create table if not exists scenarios (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  description     text,
  state           text not null default 'modeled' check (state in ('modeled', 'committed')),
  parent_baseline uuid references scenarios(id) on delete set null,
  created_at      timestamptz not null default now(),
  committed_at    timestamptz
);

alter table scenarios enable row level security;
create policy "users see own scenarios"
  on scenarios for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── scenario_adjustments ─────────────────────────────────────────────────────

create table if not exists scenario_adjustments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  scenario_id     uuid not null references scenarios(id) on delete cascade,
  category_id     uuid not null references budget_categories(id) on delete cascade,
  month           integer not null check (month between 1 and 12),
  year            integer not null,
  delta_amount    numeric not null,
  label           text,
  created_at      timestamptz not null default now()
);

alter table scenario_adjustments enable row level security;
create policy "users see own scenario_adjustments"
  on scenario_adjustments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── wealth_snapshots ─────────────────────────────────────────────────────────

create table if not exists wealth_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  snapshot_date        date not null,
  net_worth            numeric,
  investment_balance   numeric,
  retirement_balance   numeric,
  other_assets         numeric,
  liabilities          numeric,
  notes                text,
  created_at           timestamptz not null default now()
);

create index if not exists wealth_snapshots_user_date on wealth_snapshots(user_id, snapshot_date desc);

alter table wealth_snapshots enable row level security;
create policy "users see own wealth_snapshots"
  on wealth_snapshots for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── ai_briefings ─────────────────────────────────────────────────────────────

create table if not exists ai_briefings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  generated_at     timestamptz not null default now(),
  context_summary  text,
  narrative        text,
  module_context   text,
  is_cached        boolean not null default false
);

alter table ai_briefings enable row level security;
create policy "users see own ai_briefings"
  on ai_briefings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── user_profiles ─────────────────────────────────────────────────────────────
-- Mirrors the onboarding profile (currently in localStorage) in the DB.

create table if not exists user_profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  focuses             text[] not null default '{}',
  commitments         text[] not null default '{}',
  planning_horizon    integer[] not null default '{}',
  period_options      text[] not null default '{}',
  period_default      text,
  data_path           text check (data_path in ('import', 'partial', 'manual')),
  onboarding_complete boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table user_profiles enable row level security;
create policy "users see own profile"
  on user_profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row when a new user signs up
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into user_profiles (id) values (new.id);
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
