// Policy checks for the MCP OAuth endpoints (registration + consent). Pure, no I/O.

// claude.ai matches the live oauth_clients rows; claude.com comes from Anthropic's
// documented callback and is unverified. A wrong value fails closed on new
// registrations only (already-registered clients are grandfathered).
const ALLOWED_HTTPS_REDIRECTS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  // ChatGPT's callback carries a per-connector ID. Pinned to the one connector in
  // the live oauth_clients rows (2026-10-25): any chatgpt.com user can mint their
  // own ID, so a pattern would let someone else's connector register here.
  // A new ChatGPT connector needs its ID added by hand.
  'https://chatgpt.com/connector/oauth/JtL22DYxfAQu',
]

// RFC 8252 loopback redirect for native/CLI clients; any port and path.
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

const MAX_REDIRECT_URIS = 5
const MAX_CLIENT_NAME = 100

function checkRedirectUri(uri) {
  if (typeof uri !== 'string') return 'redirect_uris entries must be strings.'
  let url
  try {
    url = new URL(uri)
  } catch {
    return `Invalid redirect_uri: ${uri}`
  }
  if (url.hash || uri.includes('#')) return 'redirect_uri must not contain a fragment.'
  if (url.username || url.password) return 'redirect_uri must not contain credentials.'
  if (url.protocol === 'https:') {
    if (url.search || uri.includes('?')) return 'redirect_uri must not contain a query string.'
    if (ALLOWED_HTTPS_REDIRECTS.includes(url.origin + url.pathname)) return null
    return 'redirect_uri is not an allowed callback.'
  }
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)) return null
  return 'redirect_uri must be an allowed https callback or an http loopback address.'
}

export function validateRedirectUris(uris) {
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, reason: `redirect_uris must be an array of 1 to ${MAX_REDIRECT_URIS} strings.` }
  }
  for (const uri of uris) {
    const reason = checkRedirectUri(uri)
    if (reason) return { ok: false, reason }
  }
  // Store the parsed form so case and dot-segment variants collapse to one string.
  return { ok: true, uris: uris.map(uri => new URL(uri).href) }
}

export function sanitizeClientName(name) {
  if (typeof name !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, MAX_CLIENT_NAME).trim()
  return cleaned || null
}

export function isSameOrigin(request) {
  const origin = request.headers.get('origin')
  if (!origin) return false
  return origin === new URL(request.url).origin
}

export function describeRedirect(uri) {
  let host = String(uri)
  try {
    host = new URL(uri).host
  } catch {
    // keep the raw string
  }
  return { host, display: host }
}
