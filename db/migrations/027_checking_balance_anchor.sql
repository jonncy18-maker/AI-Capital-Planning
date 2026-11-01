-- Checking balance anchor for the Pay Periods WEEKS tab: one typed balance
-- (as of a date) per user + checking account, the starting point of the rolling
-- weekly cash projection. Also declares the user_profiles pay-schedule columns
-- that app/api/profile/route.js already writes but no earlier migration declared.
--
-- Idempotent: safe to re-run. Apply to the Neon branch `dev-local` only; do not
-- run against the live branch from an agent.

create table if not exists checking_balance_anchors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  as_of_date date not null,
  balance numeric(14,2) not null check (abs(balance) <= 1000000000),
  updated_at timestamptz not null default now(),
  constraint checking_balance_anchors_user_account_key unique (user_id, account_id)
);
create index if not exists checking_balance_anchors_user_idx on checking_balance_anchors(user_id);

-- Documents columns that app/api/profile/route.js already writes but no migration declares.
alter table user_profiles add column if not exists pay_frequency text;
alter table user_profiles add column if not exists pay_day_1 integer;
alter table user_profiles add column if not exists pay_day_2 integer;
comment on column user_profiles.pay_frequency is 'Settings option id, e.g. semi_monthly or biweekly (see src/modules/settings/Settings.jsx); null = not set.';
