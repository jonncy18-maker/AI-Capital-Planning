-- ── Income-side scenarios ────────────────────────────────────────────────────
-- Scenarios were expense-only: each scenario_adjustments row is a signed delta
-- on a budget_category, and committing writes those into forecast_line_items.
-- Income lives on a separate track (user_profiles salary/bonus → the post-tax
-- forecast in incomeVsExpenses), with no per-month line items.
--
-- This adds an income side. Income scenarios reuse the scenarios table, tagged
-- with kind = 'income' (existing rows default to 'expense'). Their per-month
-- deltas live in a dedicated table because income has no budget_category to
-- hang off of. Committing an income scenario does NOT write forecast_line_items
-- (income isn't there); instead the context loader folds committed income
-- net deltas into the income forecast the dashboard + AI brief already read.

alter table scenarios
  add column if not exists kind text not null default 'expense';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scenarios_kind_check'
  ) then
    alter table scenarios
      add constraint scenarios_kind_check check (kind in ('expense', 'income'));
  end if;
end $$;

create table if not exists scenario_income_adjustments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  scenario_id   uuid not null references scenarios(id) on delete cascade,
  year          integer not null,
  month         integer not null check (month between 1 and 12),
  income_type   text not null check (income_type in ('salary', 'bonus', 'recurring', 'windfall')),
  gross_amount  numeric not null default 0,   -- signed monthly GROSS delta (for display/audit)
  net_amount    numeric not null,             -- signed monthly NET (post-tax) delta, folded into the forecast
  taxable       boolean not null default true,
  label         text,
  created_at    timestamptz not null default now()
);

create index if not exists sia_scenario
  on scenario_income_adjustments(scenario_id);
create index if not exists sia_user_year
  on scenario_income_adjustments(user_id, year);
