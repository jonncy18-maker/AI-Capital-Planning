-- ── OAuth for the MCP connector (Claude Code Remote / claude.ai / Cowork) ───
-- Phase 2 of the MCP connector: claude.ai's own connector settings require a
-- real OAuth 2.0 authorization-code + PKCE flow (a bearer-token header isn't
-- an option there, unlike Claude Code's CLI config). Access tokens minted by
-- this flow land in the existing personal_access_tokens table — verified by
-- the exact same getSessionOrToken() every app/api/** route already calls,
-- so nothing about the resource-server side changes.

-- Public OAuth clients (no client_secret — PKCE is the only client auth,
-- consistent with token_endpoint_auth_methods_supported: ["none"]),
-- registered via Dynamic Client Registration (RFC 7591) at /api/mcp/register.
create table if not exists oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

-- Short-lived, single-use authorization codes from /api/mcp/authorize,
-- redeemed at /api/mcp/token. code_challenge is the PKCE commitment; the
-- token endpoint verifies it against the client-supplied code_verifier.
create table if not exists oauth_authorization_codes (
  code text primary key,
  client_id text not null references oauth_clients(client_id) on delete cascade,
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists oauth_authorization_codes_expires
  on oauth_authorization_codes(expires_at);
