-- Drop pre-existing two-value constraint before adding the three-value replacement
ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_state_check;
ALTER TABLE scenarios ADD CONSTRAINT scenarios_state_check
  CHECK (state IN ('modeled', 'committed', 'idea'));
