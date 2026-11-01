-- Maps an app account (the primary checking account) to the account name Monarch
-- stamps on its imported transactions. The Pay Periods WEEKS tab uses it to walk
-- real checking history back from the typed balance.
--
-- Idempotent: safe to re-run. Apply to the Neon branch `dev-local` only, and only
-- after John approves; do not run against the live branch from an agent.
-- Numbering: 028 is taken elsewhere and 030 is reserved.

alter table accounts add column if not exists monarch_account_name text;
comment on column accounts.monarch_account_name is 'Exact Monarch transactions.account text for this account (e.g. ''Checking - 9377 (...9377)''); null = not mapped. Used by WEEKS history.';
