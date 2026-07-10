-- ── forecast_line_items.source_scenario_id ──────────────────────────────────
-- Tags forecast_line_items rows written by committing a scenario, so the
-- write can be cleanly reversed (un-commit, or delete the scenario) by
-- deleting every row tagged with that scenario's id.

alter table forecast_line_items
  add column if not exists source_scenario_id uuid references scenarios(id);

create index if not exists forecast_line_items_source_scenario
  on forecast_line_items(source_scenario_id)
  where source_scenario_id is not null;
