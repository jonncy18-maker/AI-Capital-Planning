import { authClient } from '../neon/authClient.js'

// Neon Auth session hook. Wraps authClient.useSession() (Better Auth's
// live-updating session store) but keeps the exact return shape the
// original version had ({ session, loading, user }), so AppRoot.jsx
// and every other consumer needed zero changes beyond this file's internals.
export function useAuth() {
  const { data, isPending } = authClient.useSession()
  return {
    session: data?.session ?? null,
    loading: isPending,
    user: data?.user ?? null,
  }
}
