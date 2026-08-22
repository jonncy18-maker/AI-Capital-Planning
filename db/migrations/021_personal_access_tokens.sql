-- ── personal_access_tokens ───────────────────────────────────────────────────
-- Bearer tokens for machine clients (the MCP connector) that can't hold a
-- Neon Auth session cookie. Only the SHA-256 hash is stored — the raw token
-- is shown once at creation time and is not recoverable from the database.
-- Resolves to the same user_id every app/api/** route already scopes by, so
-- a token carries exactly the access that user's own session would.

create table if not exists personal_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists personal_access_tokens_user
  on personal_access_tokens(user_id);
