-- NOT APPLIED to any Neon branch by the build. John applies it to dev-local
-- first, then dev, after review and after 028. Code works without it: the
-- import route and undo route detect these columns and degrade (undoable:false).
alter table import_logs add column if not exists source text;                       -- 'monarch_import' for imports made by /api/transactions/import; null = older or in-app import (not undoable)
alter table import_logs add column if not exists reclassified integer;
alter table import_logs add column if not exists categories_auto_mapped integer;
alter table import_logs add column if not exists status text;                        -- null = pre-030 log; 'committed' | 'undone'
alter table import_logs add column if not exists undone_at timestamptz;
alter table import_logs add column if not exists undo_summary jsonb;
alter table import_logs add column if not exists undo_token uuid;                   -- set by the undo transaction; every undo write checks it

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'import_logs_status_check') then
    alter table import_logs
      add constraint import_logs_status_check check (status is null or status in ('committed', 'undone'));
  end if;
end $$;

alter table transactions add column if not exists import_log_id uuid references import_logs(id) on delete set null;
create index if not exists transactions_import_log_id on transactions(import_log_id) where import_log_id is not null;

create table if not exists import_log_rows (
  id              uuid primary key default gen_random_uuid(),
  import_log_id   uuid not null references import_logs(id) on delete cascade,
  user_id         uuid not null,
  transaction_id  uuid not null,
  kind            text not null check (kind in ('insert', 'reclassify')),
  before_category text,
  before_group    text,
  before_notes    text,
  before_tags     text,
  after_category  text,
  after_group     text,
  after_notes     text,
  after_tags      text,
  tags_tracked    boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (import_log_id, transaction_id)
);
create index if not exists import_log_rows_user_log on import_log_rows(user_id, import_log_id);

create table if not exists import_log_categories (
  import_log_id      uuid not null references import_logs(id) on delete cascade,
  user_id            uuid not null,
  budget_category_id uuid not null,
  category           text not null,
  created_at         timestamptz default now(),
  primary key (import_log_id, budget_category_id)
);
