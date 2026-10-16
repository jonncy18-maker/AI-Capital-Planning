#!/bin/bash
# Starts the app on :3100 with placeholder env (command line only; no .env.local written).
# Auth and every /api call are faked in the browser by mock.mjs, so no database is needed.
cd "$(dirname "$0")/../.."
DATABASE_URL=postgres://x:x@localhost/x NEON_AUTH_BASE_URL=http://localhost:3100/mock-auth \
NEON_AUTH_COOKIE_SECRET=abcdefghijklmnopqrstuvwxyz0123456789ABCD ANTHROPIC_API_KEY=x \
NEXT_TELEMETRY_DISABLED=1 exec node_modules/.bin/next dev --webpack -p 3100
