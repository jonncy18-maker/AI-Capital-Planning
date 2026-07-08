-- ── Credit Cards Module ────────────────────────────────────────────────────────

-- ── credit_cards ─────────────────────────────────────────────────────────────
-- One row per credit card the user holds. `is_default` card catches all
-- non-optimized spend in the points forecast engine.

create table if not exists credit_cards (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  name                 text not null,
  issuer               text,
  network              text check (network in ('visa', 'mastercard', 'amex', 'discover', 'other')),
  last_four            text,
  points_program       text,
  is_default           boolean not null default false,
  statement_close_day  integer check (statement_close_day >= 1 and statement_close_day <= 31),
  due_days_after_close integer not null default 21,
  annual_fee           numeric,
  annual_fee_month     integer check (annual_fee_month >= 1 and annual_fee_month <= 12),
  points_value_cents   numeric not null default 1.0,
  color                text,
  active               boolean not null default true,
  display_order        integer not null default 0,
  created_at           timestamptz not null default now()
);

create index if not exists credit_cards_user on credit_cards(user_id, display_order);

alter table credit_cards enable row level security;
create policy "users see own credit_cards"
  on credit_cards for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── credit_card_earn_rates ────────────────────────────────────────────────────
-- Earn rates per card per spend category slug. Missing slugs fall back to the
-- 'other' row (base earn rate).

create table if not exists credit_card_earn_rates (
  id           uuid primary key default gen_random_uuid(),
  card_id      uuid not null references credit_cards(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  cc_category  text not null,
  earn_rate    numeric not null default 1.0,
  created_at   timestamptz not null default now(),
  unique (card_id, cc_category)
);

alter table credit_card_earn_rates enable row level security;
create policy "users see own credit_card_earn_rates"
  on credit_card_earn_rates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── credit_card_points ────────────────────────────────────────────────────────
-- Point balance snapshots. Latest row per card = current balance baseline.

create table if not exists credit_card_points (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references credit_cards(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  balance     integer not null default 0,
  as_of_date  date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists credit_card_points_card_date on credit_card_points(card_id, as_of_date desc);

alter table credit_card_points enable row level security;
create policy "users see own credit_card_points"
  on credit_card_points for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── credit_card_point_redemptions ─────────────────────────────────────────────
-- Planned point redemptions by card and month. User-entered, like expense
-- forecast overrides.

create table if not exists credit_card_point_redemptions (
  id            uuid primary key default gen_random_uuid(),
  card_id       uuid not null references credit_cards(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  year          integer not null,
  month         integer not null check (month >= 1 and month <= 12),
  points_amount integer not null,
  description   text,
  created_at    timestamptz not null default now()
);

create index if not exists credit_card_point_redemptions_user_year
  on credit_card_point_redemptions(user_id, year, month);

alter table credit_card_point_redemptions enable row level security;
create policy "users see own credit_card_point_redemptions"
  on credit_card_point_redemptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Extend budget_categories ──────────────────────────────────────────────────
-- cc_category: which reward slug applies to this budget category
-- cash_only:   true = cannot go on a credit card (ACH rent, tax payments, etc.)

alter table budget_categories
  add column if not exists cc_category  text,
  add column if not exists cash_only    boolean not null default false;

-- ── Extend bills ─────────────────────────────────────────────────────────────
-- statement_close_day: when the statement closes for credit card bills.
-- Enables cash flow timing: spend before close_day → bill due ~21 days later.

alter table bills
  add column if not exists statement_close_day integer
    check (statement_close_day >= 1 and statement_close_day <= 31);

-- ── Extend user_profiles ──────────────────────────────────────────────────────
-- cc_coverage_pct:     % of eligible expenses that go on a card vs. cash/ACH
-- cc_optimization_pct: % of card spend routed to the best card per category
--                      (0 = all on default card, 100 = always optimal card)

alter table user_profiles
  add column if not exists cc_coverage_pct     integer not null default 80
    check (cc_coverage_pct >= 0 and cc_coverage_pct <= 100),
  add column if not exists cc_optimization_pct integer not null default 100
    check (cc_optimization_pct >= 0 and cc_optimization_pct <= 100);
