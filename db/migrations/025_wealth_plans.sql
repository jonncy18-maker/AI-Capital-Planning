-- Immutable saved assumptions: editing a baseline creates a new version.
create table if not exists wealth_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  start_date date not null,
  start_balance numeric not null check (start_balance between 0 and 1000000000),
  monthly_contribution numeric not null check (abs(monthly_contribution) <= 1000000000),
  annual_return numeric not null check (annual_return between 0 and 0.12),
  horizon integer not null check (horizon between 5 and 40),
  retirement_target numeric not null check (retirement_target between 0 and 1000000000),
  emergency_cash_target numeric check (emergency_cash_target between 0 and 1000000000),
  starting_contributions_ytd numeric check (abs(starting_contributions_ytd) <= 1000000000),
  annual_contributions jsonb not null default '{}'::jsonb check (jsonb_typeof(annual_contributions) = 'object'),
  annual_contributions_without_commitments jsonb not null default '{}'::jsonb check (jsonb_typeof(annual_contributions_without_commitments) = 'object'),
  annual_commitment_drain numeric not null default 0 check (annual_commitment_drain between 0 and 1000000000),
  include_commitments boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists wealth_plans_user_created on wealth_plans(user_id, created_at desc);
alter table wealth_snapshots add column if not exists emergency_cash numeric check (emergency_cash between 0 and 1000000000);
alter table wealth_snapshots add column if not exists investment_contributions_ytd numeric check (abs(investment_contributions_ytd) <= 1000000000);
comment on column wealth_snapshots.emergency_cash is 'Explicit reserve balance, a subset of other_assets; never added to net worth again.';
comment on column wealth_snapshots.investment_contributions_ytd is 'Manually recorded calendar-year cumulative investment net deposits as of snapshot_date; negative means net withdrawals; NULL means unknown.';
