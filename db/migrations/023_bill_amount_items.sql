-- Apply before using monthly itemization. NULL preserves legacy scalar entry;
-- [] is an intentionally itemized month with a zero aggregate.
ALTER TABLE bill_amounts ADD COLUMN IF NOT EXISTS items JSONB;
ALTER TABLE bill_amounts ADD COLUMN IF NOT EXISTS item_revision INTEGER NOT NULL DEFAULT 0;
