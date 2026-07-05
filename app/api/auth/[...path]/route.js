import { auth } from '../../../../src/lib/neon/authServer.js'

// Proxies all Neon Auth (Better Auth) requests — sign-up, sign-in, get-session,
// token refresh, etc. — from the app's own origin to the Neon Auth backend,
// handling cookie-based sessions, JWT refresh, and CSRF automatically.
export const { GET, POST } = auth.handler()
