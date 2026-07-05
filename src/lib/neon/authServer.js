import { createNeonAuth } from '@neondatabase/auth/next/server'

// Unified server-side Neon Auth instance used by every app/api/** route.
// Provides `auth.getSession()` and `auth.handler()` (mounted at
// app/api/auth/[...path]/route.js).
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET,
  },
})
