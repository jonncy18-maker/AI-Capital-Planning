import { randomBytes, createHash } from 'node:crypto'
import { getNeonSql } from '../../../../src/lib/neon/client.js'

// OAuth token endpoint. Exchanges a one-time authorization code (+ PKCE
// verifier) for an access token — which is just a row in the same
// personal_access_tokens table scripts/create-mcp-token.js writes to, so
// every app/api/** route verifies it exactly the same way regardless of how
// it was minted. No refresh tokens: the access token doesn't expire, same
// trust model as a manually-created token, revocable the same way
// (personal_access_tokens.revoked_at).

function base64urlSha256(input) {
  return createHash('sha256').update(input).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function oauthError(error, description, status = 400) {
  return Response.json({ error, error_description: description }, { status })
}

export async function POST(request) {
  let params
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    params = new URLSearchParams(await request.json().then(b => Object.entries(b ?? {})))
  } else {
    params = new URLSearchParams(await request.text())
  }

  const grantType = params.get('grant_type')
  if (grantType !== 'authorization_code') {
    return oauthError('unsupported_grant_type', 'Only "authorization_code" is supported.')
  }

  const code = params.get('code')
  const redirectUri = params.get('redirect_uri')
  const clientId = params.get('client_id')
  const codeVerifier = params.get('code_verifier')
  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return oauthError('invalid_request', 'Missing code, redirect_uri, client_id, or code_verifier.')
  }

  const sql = getNeonSql()
  const [row] = await sql`
    SELECT * FROM oauth_authorization_codes WHERE code = ${code}
  `
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
    return oauthError('invalid_grant', 'Code is invalid, expired, or already used.')
  }
  if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
    return oauthError('invalid_grant', 'client_id or redirect_uri does not match the authorization request.')
  }
  if (base64urlSha256(codeVerifier) !== row.code_challenge) {
    return oauthError('invalid_grant', 'code_verifier does not match code_challenge.')
  }

  // Single-use — mark it consumed before minting anything, so a retried or
  // replayed request can't mint a second token from the same code. The
  // `used_at IS NULL` guard plus RETURNING makes this atomic: only one
  // concurrent request can ever get a non-empty result back.
  const consumed = await sql`
    UPDATE oauth_authorization_codes SET used_at = now()
    WHERE code = ${code} AND used_at IS NULL
    RETURNING code
  `
  if (consumed.length === 0) {
    return oauthError('invalid_grant', 'Code was already used.')
  }

  const [client] = await sql`SELECT client_name FROM oauth_clients WHERE client_id = ${clientId}`

  const accessToken = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(accessToken).digest('hex')
  await sql`
    INSERT INTO personal_access_tokens (user_id, name, token_hash)
    VALUES (${row.user_id}, ${`OAuth: ${client?.client_name || clientId}`}, ${tokenHash})
  `

  return Response.json({ access_token: accessToken, token_type: 'bearer' })
}
