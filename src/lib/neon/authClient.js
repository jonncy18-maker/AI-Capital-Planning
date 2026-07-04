'use client'

import { createAuthClient } from '@neondatabase/auth/next'

// Client-side Neon Auth instance. Talks to this app's own /api/auth/* routes
// (same-origin, cookie-based session) — never Neon's auth domain directly.
export const authClient = createAuthClient()
