-- ── forecast_line_items ───────────────────────────────────────────────────────
-- Independent forecast line items. The forecast is its own dataset, seeded from
-- the budget once and edited independently thereafter — budget edits no longer
-- flow into the forecast, and forecast edits never touch the budget.

create table if not exists forecast_line_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  budget_year   integer not null,
  category_id   uuid not null references budget_categories(id) on delete cascade,
  month         integer not null check (month between 1 and 12),
  amount        numeric not null,
  label         text,
  note          text,
  source        text not null default 'manual', -- 'seed' (copied from budget) | 'manual'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists forecast_line_items_user_year
  on forecast_line_items(user_id, budget_year, month);

alter table forecast_line_items enable row level security;

create policy "users see own forecast_line_items"
  on forecast_line_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
