-- Fixes a gap in the Neon schema recovery (not a Supabase migration --
-- Supabase's 001_initial_schema.sql already has this constraint, see line 47.
-- This file documents the same fix applied directly to the Neon dev branch
-- during the Phase B1 broad rollout (2026-07-05), discovered when a ported
-- budget_categories route needed to upsert by (user_id, category) and found
-- no conflict target to target -- the constraint had been missed when the
-- Neon schema was originally constructed from live introspection in Phase B0.
--
-- Idempotent: safe to run against Supabase too (already exists there) or
-- re-run against Neon.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'budget_categories_user_id_category_key'
  ) then
    alter table budget_categories
      add constraint budget_categories_user_id_category_key unique (user_id, category);
  end if;
end $$;
