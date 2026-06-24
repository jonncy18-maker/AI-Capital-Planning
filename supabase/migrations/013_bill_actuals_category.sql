-- Allows a bill to pull its historical outflow from actual transaction data
-- for a named budget category, rather than requiring manual bill_amounts entries.
-- When actuals_category is set, loadOutflowSeries() sums past transactions in
-- that category per month and uses the result as the bill's resolved amount.
-- Future months are unaffected (forecast_category_id / fixed_amount still apply).

alter table bills
  add column if not exists actuals_category text;
