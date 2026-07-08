# monarch-sync Edge Function

Pulls transactions from **Monarch Money** and returns them normalized to the same
column shape the app's Monarch CSV import already understands, so a sync reuses
the existing parse → category-map → dedup-import pipeline.

## ⚠️ Unofficial

Monarch has **no official public API**. This function talks to Monarch's private
GraphQL endpoint — the same backend the Monarch web app uses — exactly as the
community connectors do (e.g. the [`monarchmoney`](https://github.com/hammem/monarchmoney)
Python library). It can break without notice if Monarch changes its auth or
schema. **The Monarch CSV export remains the supported, always-available path.**

## Why server-side

- Monarch's endpoint is not CORS-enabled, so the browser cannot call it directly.
- A session token (and the user's credentials) must never live in browser JS.

Credentials arrive over the function's authenticated channel (Supabase verifies
the signed-in user's JWT at the gateway), are used once to obtain a short-lived
session token, and are never persisted.

## Deploy

```sh
supabase functions deploy monarch-sync
```

No secrets are required — the user supplies their own Monarch credentials per
sync from the Connections card in **Settings**.

## Request / response

Invoked from the app via `supabase.functions.invoke('monarch-sync', { body })`.

```jsonc
// request body
{ "email": "you@example.com", "password": "…", "mfaCode": "123456", "since": "2026-01-01" }

// response
{ "transactions": [ { "date": "2026-05-01", "merchant": "…", "category": "…",
                      "account": "…", "amount": -42.5, "notes": "" } ],
  "count": 1 }
```

`mfaCode` and `since` are optional. If Monarch requires multi-factor auth, the
function returns an error asking for the current code; resubmit with `mfaCode`.

## Hardening to consider before relying on this

- Rate-limit per user; Monarch may throttle automated logins.
- Consider storing only a refresh/session token (encrypted) instead of asking for
  the password each sync.
- Surface MFA as an explicit second step rather than a single retry.
