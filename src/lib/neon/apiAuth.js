import { createHash } from 'node:crypto'
import { auth } from './authServer.js'
import { getNeonSql } from './client.js'

// Drop-in replacement for `auth.getSession()` on every app/api/** route.
// Accepts either the existing Neon Auth session cookie (browser) or a
// `Authorization: Bearer <token>` header (the MCP connector, or any other
// machine client) and resolves both to the same `{ data: { user: { id } } }`
// shape so call sites don't need to branch on which one was used.
//
// Only a SHA-256 hash of each personal access token is ever stored — the
// raw token exists only at creation time, on the client that requested it.
export async function getSessionOrToken(request) {
  const authHeader = request?.headers?.get?.('authorization') || ''
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]

  if (bearer) {
    const tokenHash = createHash('sha256').update(bearer).digest('hex')
    const sql = getNeonSql()
    const [row] = await sql`
      SELECT user_id FROM personal_access_tokens
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
    `
    if (!row) return { data: null }

    // Best-effort — a failed timestamp update should never block the request.
    sql`UPDATE personal_access_tokens SET last_used_at = now() WHERE token_hash = ${tokenHash}`
      .catch(() => {})

    return { data: { user: { id: row.user_id } } }
  }

  return auth.getSession()
}
