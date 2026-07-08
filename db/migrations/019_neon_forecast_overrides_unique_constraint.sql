-- Fixes another gap in the Neon schema recovery (not a Supabase migration --
-- Supabase's forecast_overrides table (recovered in
-- 015_recover_undocumented_tables.sql from live introspection, since it was
-- never committed to a migration originally) is upserted via
-- src/lib/db/forecastOverrides.js#upsertForecastOverride with
-- onConflict: 'user_id,category_id,budget_year,month', implying a unique
-- constraint on that column set -- but the constraint was never present on
-- Supabase (it isn't in 015's reconstructed DDL either) nor on the Neon dev
-- branch. Same class of gap as 016_neon_budget_categories_unique_constraint.sql
-- and 017_neon_missing_unique_constraints.sql, found while porting
-- forecast-overrides to app/api/forecast-overrides/route.js during the
-- Phase B1 broad rollout (2026-07-05).
--
-- Idempotent: safe to run against Supabase too (adds the constraint that
-- upsert already assumed exists) or re-run against Neon.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'forecast_overrides_user_id_category_id_budget_year_month_key'
  ) then
    alter table forecast_overrides
      add constraint forecast_overrides_user_id_category_id_budget_year_month_key
      unique (user_id, category_id, budget_year, month);
  end if;
end $$;
