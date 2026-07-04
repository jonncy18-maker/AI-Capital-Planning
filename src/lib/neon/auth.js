import { createRemoteJWKSet, jwtVerify } from 'jose'

// Neon Auth (Better Auth) JWKS endpoint for this project's Neon branch.
// Pilot-only — production auth still runs through Supabase (src/lib/supabase.js,
// src/modules/auth/Login.jsx), which this file does not touch.
const JWKS_URL =
  'https://ep-royal-smoke-ajjxuq8k.neonauth.c-3.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json'

// Cached at module scope so the JWKSet (and its underlying key cache) is
// reused across requests instead of being re-fetched every time.
let jwks = null
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL))
  return jwks
}

class AuthError extends Error {
  constructor(message, status = 401) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

/**
 * Verifies a Neon Auth (Better Auth) bearer token attached to an incoming
 * Next.js Route Handler Request. Throws an AuthError with a `.status` of 401
 * on any failure; route handlers should catch this and respond accordingly.
 *
 * @param {Request} request
 * @returns {Promise<{ userId: string }>}
 */
export async function verifyNeonAuthRequest(request) {
  const authHeader = request.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new AuthError('Missing or malformed Authorization: Bearer <token> header.')
  }

  try {
    const { payload } = await jwtVerify(token, getJwks())

    if (!payload.sub) {
      throw new AuthError('Token is missing a subject (sub) claim.')
    }

    return { userId: payload.sub }
  } catch (err) {
    if (err instanceof AuthError) throw err
    throw new AuthError(`Invalid or expired token: ${err.message}`)
  }
}
