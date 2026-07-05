-- Fixes another gap in the Neon schema recovery (not a Supabase migration --
-- Supabase already has all four of these constraints; see the migrations
-- named in each block below. Found by grepping every committed migration
-- for `unique` and cross-checking pg_constraint on the Neon dev branch
-- during Phase B1 Wave 2 prep (2026-07-05) -- the same class of gap as
-- 016_neon_budget_categories_unique_constraint.sql, just not caught the
-- first time because that check only covered budget_categories.
--
-- Idempotent: safe to run against Supabase too (already exists there) or
-- re-run against Neon.

do $$
begin
  -- income_actuals: unique (user_id, year, month) -- 011_income_actuals.sql line 20
  if not exists (
    select 1 from pg_constraint where conname = 'income_actuals_user_id_year_month_key'
  ) then
    alter table income_actuals
      add constraint income_actuals_user_id_year_month_key unique (user_id, year, month);
  end if;

  -- tax_brackets: unique (year, jurisdiction, filing_status) -- 006_tax.sql line 27
  if not exists (
    select 1 from pg_constraint where conname = 'tax_brackets_year_jurisdiction_filing_status_key'
  ) then
    alter table tax_brackets
      add constraint tax_brackets_year_jurisdiction_filing_status_key unique (year, jurisdiction, filing_status);
  end if;

  -- budget_status: unique (user_id, budget_year, budget_version) -- 005_budget_status.sql line 15
  if not exists (
    select 1 from pg_constraint where conname = 'budget_status_user_id_budget_year_budget_version_key'
  ) then
    alter table budget_status
      add constraint budget_status_user_id_budget_year_budget_version_key unique (user_id, budget_year, budget_version);
  end if;

  -- credit_card_earn_rates: unique (card_id, cc_category) -- 007_credit_cards.sql line 46
  if not exists (
    select 1 from pg_constraint where conname = 'credit_card_earn_rates_card_id_cc_category_key'
  ) then
    alter table credit_card_earn_rates
      add constraint credit_card_earn_rates_card_id_cc_category_key unique (card_id, cc_category);
  end if;
end $$;
