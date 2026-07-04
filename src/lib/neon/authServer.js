import { createNeonAuth } from '@neondatabase/auth/next/server'

// Unified server-side Neon Auth instance for the commitments pilot. Provides
// `auth.getSession()` (used by the /api/commitments route handlers) and
// `auth.handler()` (mounted at app/api/auth/[...path]/route.js). Pilot-only —
// production auth still runs through Supabase (src/lib/supabase.js,
// src/modules/auth/Login.jsx), which this file does not touch.
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET,
  },
})
