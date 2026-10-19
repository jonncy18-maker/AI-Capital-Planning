-- Wealth Trajectory assumptions live on the immutable plan row as one jsonb
-- object (retirement age, return mode/presets, scenarios, caps, emergency fund,
-- surplus). NULL = a plan saved before assumptions existed.
alter table wealth_plans add column if not exists assumptions jsonb
  check (assumptions is null or jsonb_typeof(assumptions) = 'object');
-- Index presets run above the old 12% ceiling (S&P 10-year is 14.67%).
alter table wealth_plans drop constraint if exists wealth_plans_annual_return_check;
alter table wealth_plans add constraint wealth_plans_annual_return_check
  check (annual_return between 0 and 0.25);
