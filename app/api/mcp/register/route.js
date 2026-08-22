import { randomUUID } from 'node:crypto'
import { getNeonSql } from '../../../../src/lib/neon/client.js'

// Dynamic Client Registration (RFC 7591) — lets claude.ai's "Add custom
// connector" flow register itself automatically instead of you hand-entering
// an OAuth Client ID. Public client only: no client_secret, PKCE is the sole
// client authentication at the token endpoint.
export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_client_metadata', error_description: 'Body must be valid JSON.' }, { status: 400 })
  }

  const redirectUris = body?.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every(u => typeof u === 'string')) {
    return Response.json(
      { error: 'invalid_client_metadata', error_description: 'Field "redirect_uris" must be a non-empty array of strings.' },
      { status: 400 }
    )
  }

  const clientId = randomUUID()
  const clientName = typeof body.client_name === 'string' ? body.client_name : null

  try {
    const sql = getNeonSql()
    await sql`
      INSERT INTO oauth_clients (client_id, client_name, redirect_uris)
      VALUES (${clientId}, ${clientName}, ${redirectUris})
    `
    return Response.json(
      {
        client_id: clientId,
        client_name: clientName,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      },
      { status: 201 }
    )
  } catch (err) {
    return Response.json({ error: 'server_error', error_description: err.message }, { status: 500 })
  }
}
