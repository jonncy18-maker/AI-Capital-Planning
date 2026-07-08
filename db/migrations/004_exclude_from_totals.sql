-- ── Exclude-from-totals flag ────────────────────────────────────────────────
-- Run in the Supabase SQL editor. Adds a per-category switch so account
-- transfers and credit-card payments (which are not real income or expense)
-- can be dropped from spend/income aggregations everywhere.

alter table budget_categories
  add column if not exists exclude_from_totals boolean not null default false;

-- Default-exclude the classic transfer categories. Safe to re-run; only flips
-- the seeded transfer rows, never the user's other categories.
update budget_categories
  set exclude_from_totals = true
  where "group" = 'Transfers'
    and category in ('Transfer', 'Transfers', 'Credit Card Payment');
