-- ── Link bills to credit cards ───────────────────────────────────────────────
-- A credit-card bill can be linked to the credit_cards row it pays off, so the
-- Pay Period Planner can auto-derive the statement amount (projected from
-- forecast spend routed to that card via the points engine) and time the
-- payment by the card's billing cycle, instead of relying on a hand-typed
-- amount or fragile name matching.

alter table bills
  add column if not exists credit_card_id uuid references credit_cards(id) on delete set null;

create index if not exists bills_credit_card_id_idx on bills(credit_card_id);
