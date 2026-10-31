-- NOT APPLIED to any Neon branch by the build. John applies it to dev-local
-- first, then dev, after review. Code works without it (see contract §7).
alter table budget_categories add column if not exists mapping_source text;   -- null = user/seed; 'auto_import' = auto-created by import_monarch_transactions
alter table budget_categories add column if not exists mapping_note text;     -- reason, e.g. 'closest:Coffee Shops (0.82)'
alter table transactions add column if not exists tags text;                  -- Monarch Tags, stored verbatim; null = never recorded
