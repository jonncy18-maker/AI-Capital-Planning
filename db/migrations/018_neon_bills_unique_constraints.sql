-- Fixes another gap in the Neon schema recovery (not a Supabase migration --
-- Supabase never needed explicit unique constraints for these two upserts
-- because 015_recover_undocumented_tables.sql's onConflict targets
-- ('bill_id,year,month' for bill_amounts, 'account_id,year,month,period_half'
-- for account_balances) were only ever exercised through supabase-js, which
-- doesn't require a matching DB constraint to accept an onConflict option the
-- way a raw `INSERT ... ON CONFLICT` does). Found while porting the `bills`
-- module (src/lib/db/bills.js) to Neon API routes during Phase B1 rollout
-- (2026-07-05), the same class of gap as 016/017 -- confirmed missing via
-- pg_constraint introspection on the Neon dev branch before writing the
-- upsertBillAmount/upsertAccountBalance routes.
--
-- Idempotent: safe to run against Supabase too (harmless no-op there since
-- these upserts already work) or re-run against Neon.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bill_amounts_bill_id_year_month_key'
  ) then
    alter table bill_amounts
      add constraint bill_amounts_bill_id_year_month_key unique (bill_id, year, month);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'account_balances_account_id_year_month_period_half_key'
  ) then
    alter table account_balances
      add constraint account_balances_account_id_year_month_period_half_key unique (account_id, year, month, period_half);
  end if;
end $$;
