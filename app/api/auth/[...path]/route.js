import { auth } from '../../../../src/lib/neon/authServer.js'

// Proxies all Neon Auth (Better Auth) requests — sign-up, sign-in, get-session,
// token refresh, etc. — from the app's own origin to the Neon Auth backend,
// handling cookie-based sessions, JWT refresh, and CSRF automatically.
const handlers = auth.handler()

export const GET = handlers.GET

// Sign-up is closed by default: this is a single-user deployment, and an open
// registration endpoint would let strangers become "authenticated" callers of
// every API route (Anthropic credit burn, monarch-sync relay). To provision a
// new account, set ALLOWED_SIGNUP_EMAILS (comma-separated) in the deployment
// env, sign up with one of those emails, then unset it.
export async function POST(request, context) {
  const { pathname } = new URL(request.url)

  if (pathname.includes('/sign-up')) {
    const allowed = (process.env.ALLOWED_SIGNUP_EMAILS ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)

    let email = ''
    try {
      email = String((await request.clone().json())?.email ?? '').trim().toLowerCase()
    } catch {
      // non-JSON body — fall through with no email, which never matches
    }

    if (!email || !allowed.includes(email)) {
      return Response.json(
        { error: 'Sign-up is disabled on this deployment.' },
        { status: 403 }
      )
    }
  }

  return handlers.POST(request, context)
}
