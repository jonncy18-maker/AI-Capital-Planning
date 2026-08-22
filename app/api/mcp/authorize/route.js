import { randomBytes } from 'node:crypto'
import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// OAuth authorization endpoint. Deliberately checks the Neon Auth session
// cookie directly (auth.getSession()), not getSessionOrToken() — this page
// is for a human in a browser to approve a connector, never for a bearer
// token to call.
const CODE_TTL_MS = 5 * 60 * 1000

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function consentPage({ clientName, values, error }) {
  const hidden = Object.entries(values).map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`).join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Authorize — AI Capital Planning</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#0c0f12; color:#eef2f5; font-family:Inter,system-ui,sans-serif; }
  .card { max-width:420px; width:calc(100% - 48px); background:#131a1e; border:1px solid #1f2a2f; border-radius:16px; padding:32px; }
  h1 { font-size:18px; margin:0 0 6px; }
  p { font-size:14px; line-height:1.6; color:#a7b2bc; margin:0 0 24px; }
  .err { color:#f87171; font-size:13px; margin-bottom:16px; }
  .row { display:flex; gap:10px; }
  button { flex:1; padding:11px; border-radius:9px; border:1px solid #1f2a2f; font-size:14px; font-weight:600; cursor:pointer; }
  .allow { background:#22d3bb; color:#06201c; border:none; }
  .deny { background:transparent; color:#a7b2bc; }
</style></head>
<body>
  <div class="card">
    <h1>Allow ${escapeHtml(clientName || 'this app')} to access your data?</h1>
    <p>This grants full read/write access to your AI Capital Planning data — bills, budget, forecast, scenarios, and everything else the in-app assistant can see.</p>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <form method="POST">
      ${hidden}
      <div class="row">
        <button class="deny" name="action" value="deny">Deny</button>
        <button class="allow" name="action" value="allow">Allow</button>
      </div>
    </form>
  </div>
</body></html>`
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

async function loadClient(sql, clientId) {
  const [client] = await sql`SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ${clientId}`
  return client ?? null
}

export async function GET(request) {
  const url = new URL(request.url)
  const params = url.searchParams

  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    const next = encodeURIComponent(url.pathname + url.search)
    return Response.redirect(`${url.origin}/?mcp_authorize=${next}`, 302)
  }

  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  const responseType = params.get('response_type')
  const codeChallenge = params.get('code_challenge')
  const codeChallengeMethod = params.get('code_challenge_method') || 'S256'
  const state = params.get('state') || ''

  if (responseType !== 'code') {
    return html(consentPage({ clientName: null, values: {}, error: 'Unsupported response_type — only "code" is supported.' }), 400)
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return html(consentPage({ clientName: null, values: {}, error: 'Missing required parameters (client_id, redirect_uri, code_challenge).' }), 400)
  }
  if (codeChallengeMethod !== 'S256') {
    return html(consentPage({ clientName: null, values: {}, error: 'Unsupported code_challenge_method — only "S256" is supported.' }), 400)
  }

  const sql = getNeonSql()
  const client = await loadClient(sql, clientId)
  if (!client) {
    return html(consentPage({ clientName: null, values: {}, error: 'Unknown client_id — this connector was not registered.' }), 400)
  }
  if (!client.redirect_uris.includes(redirectUri)) {
    return html(consentPage({ clientName: client.client_name, values: {}, error: 'redirect_uri does not match this client\'s registered URIs.' }), 400)
  }

  return html(consentPage({
    clientName: client.client_name,
    values: { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod, state },
  }))
}

export async function POST(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'access_denied', error_description: 'Not authenticated.' }, { status: 401 })
  }

  const form = await request.formData()
  const action = form.get('action')
  const clientId = form.get('client_id')
  const redirectUri = form.get('redirect_uri')
  const codeChallenge = form.get('code_challenge')
  const codeChallengeMethod = form.get('code_challenge_method') || 'S256'
  const state = form.get('state') || ''

  const sql = getNeonSql()
  const client = await loadClient(sql, clientId)
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return html(consentPage({ clientName: null, values: {}, error: 'Invalid client or redirect_uri.' }), 400)
  }

  const redirectUrl = new URL(redirectUri)
  if (action !== 'allow') {
    redirectUrl.searchParams.set('error', 'access_denied')
    if (state) redirectUrl.searchParams.set('state', state)
    return Response.redirect(redirectUrl.toString(), 302)
  }

  const code = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()
  await sql`
    INSERT INTO oauth_authorization_codes
      (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, expires_at)
    VALUES
      (${code}, ${clientId}, ${session.user.id}, ${redirectUri}, ${codeChallenge}, ${codeChallengeMethod}, ${expiresAt})
  `

  redirectUrl.searchParams.set('code', code)
  if (state) redirectUrl.searchParams.set('state', state)
  return Response.redirect(redirectUrl.toString(), 302)
}
