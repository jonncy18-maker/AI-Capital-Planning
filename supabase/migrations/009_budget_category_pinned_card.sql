alter table budget_categories
  add column if not exists pinned_card_id uuid references credit_cards(id) on delete set null;

create index if not exists budget_categories_pinned_card_id_idx on budget_categories(pinned_card_id);
