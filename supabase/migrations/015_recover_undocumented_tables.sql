-- Recovers DDL for 5 tables that exist live in Supabase but were never
-- committed to a migration file (created ad hoc via the SQL editor at some
-- point). Reconstructed from live introspection (information_schema /
-- pg_catalog / pg_policies) on 2026-07-04 as part of Supabase -> Neon
-- migration prep. All statements are idempotent (IF NOT EXISTS) since the
-- objects already exist in the live database -- this migration exists so
-- the committed schema history matches reality, not to be "applied" fresh.
--
-- Order matters: accounts before bills/account_balances (FK target),
-- bills before bill_amounts (FK target), budget_categories/credit_cards
-- already exist from earlier migrations (FK targets for bills/forecast_overrides).

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('checking', 'savings', 'investment', 'other')),
  is_primary_checking boolean not null default false,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table accounts enable row level security;

drop policy if exists "accounts: own rows only" on accounts;
create policy "accounts: own rows only" on accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists accounts_user_id_idx on accounts(user_id);

create table if not exists bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  bill_type text not null check (bill_type in ('credit_card', 'loan', 'rent', 'investment', 'subscription', 'other')),
  due_day integer check (due_day >= 1 and due_day <= 31),
  pay_same_as_due boolean not null default true,
  pay_day integer check (pay_day >= 1 and pay_day <= 31),
  payment_method text not null default 'manual' check (payment_method in ('auto', 'manual')),
  fixed_amount numeric,
  debits_from_account_id uuid references accounts(id),
  active boolean not null default true,
  display_order integer not null default 0,
  is_auto_funded boolean not null default false,
  auto_fund_account_id uuid references accounts(id),
  auto_fund_day integer check (auto_fund_day >= 1 and auto_fund_day <= 31),
  auto_fund_amount numeric,
  created_at timestamptz not null default now(),
  forecast_category_id uuid references budget_categories(id),
  forecast_divisor integer not null default 1,
  statement_close_day integer check (statement_close_day >= 1 and statement_close_day <= 31),
  credit_card_id uuid references credit_cards(id),
  actuals_category text,
  exclude_from_schedule boolean not null default false
);

alter table bills enable row level security;

drop policy if exists "bills: own rows only" on bills;
create policy "bills: own rows only" on bills
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists bills_user_id_idx on bills(user_id);

create table if not exists bill_amounts (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null,
  month integer not null check (month >= 1 and month <= 12),
  amount numeric not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table bill_amounts enable row level security;

drop policy if exists "bill_amounts: own rows only" on bill_amounts;
create policy "bill_amounts: own rows only" on bill_amounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists bill_amounts_user_id_idx on bill_amounts(user_id);
create index if not exists bill_amounts_bill_id_idx on bill_amounts(bill_id);

create table if not exists account_balances (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null,
  month integer not null check (month >= 1 and month <= 12),
  period_half integer not null check (period_half in (1, 2)),
  balance numeric not null,
  created_at timestamptz not null default now()
);

alter table account_balances enable row level security;

drop policy if exists "account_balances: own rows only" on account_balances;
create policy "account_balances: own rows only" on account_balances
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists account_balances_user_id_idx on account_balances(user_id);
create index if not exists account_balances_account_id_idx on account_balances(account_id);

create table if not exists forecast_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references budget_categories(id),
  budget_year integer not null,
  month integer not null check (month >= 1 and month <= 12),
  amount numeric not null,
  note text,
  updated_at timestamptz not null default now()
);

alter table forecast_overrides enable row level security;

drop policy if exists "Users can manage their own forecast overrides" on forecast_overrides;
create policy "Users can manage their own forecast overrides" on forecast_overrides
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists forecast_overrides_user_id_idx on forecast_overrides(user_id);
