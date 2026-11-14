import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { session: { data: { user: { id: 'test-user' } } }, inserts: [] }
const CLIENT = { client_id: 'c1', client_name: 'Claude <b>"x"</b>', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }
const sql = (strings, ...vals) => {
  const q = strings.join('?')
  if (q.includes('FROM oauth_clients')) return Promise.resolve(vals[0] === CLIENT.client_id ? [CLIENT] : [])
  if (q.includes('INSERT INTO oauth_authorization_codes')) state.inserts.push(vals)
  return Promise.resolve([])
}
vi.mock('../../src/lib/neon/client.js', () => ({ getNeonSql: () => sql }))
vi.mock('../../src/lib/neon/authServer.js', () => ({ auth: { getSession: async () => state.session } }))

const { GET, POST } = await import('../../app/api/mcp/authorize/route.js')

const ORIGIN = 'https://app.example.test'
const REDIRECT = CLIENT.redirect_uris[0]
const authorizeUrl = (redirect = REDIRECT) =>
  `${ORIGIN}/api/mcp/authorize?response_type=code&client_id=c1&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=abc&state=xyz`
const post = (action, origin = ORIGIN) => POST(new Request(`${ORIGIN}/api/mcp/authorize`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) },
  body: new URLSearchParams({ action, client_id: 'c1', redirect_uri: REDIRECT, code_challenge: 'abc', state: 'xyz' }),
}))

beforeEach(() => {
  state.session = { data: { user: { id: 'test-user' } } }
  state.inserts = []
})

describe('authorize GET', () => {
  it('shows the redirect host and escapes the app-reported name', async () => {
    const body = await (await GET(new Request(authorizeUrl()))).text()
    expect(body).toContain('Sends your authorization to: <strong>claude.ai</strong>')
    expect(body).toContain('Claude &lt;b&gt;&quot;x&quot;&lt;/b&gt;')
    expect(body).not.toContain('<b>"x"</b>')
  })

  it('refuses a redirect_uri the client did not register, with no Allow button', async () => {
    const res = await GET(new Request(authorizeUrl('https://evil.example/cb')))
    expect(res.status).toBe(400)
    expect(await res.text()).not.toContain('name="action" value="allow"')
  })
})

describe('authorize POST', () => {
  it('same-origin Allow issues a code and redirects to the registered URI', async () => {
    const res = await post('allow')
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location'))
    expect(location.origin + location.pathname).toBe(REDIRECT)
    expect(location.searchParams.get('code')).toBeTruthy()
    expect(location.searchParams.get('state')).toBe('xyz')
    expect(state.inserts).toHaveLength(1)
  })

  it('same-origin Deny redirects with access_denied and issues no code', async () => {
    const res = await post('deny')
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')).searchParams.get('error')).toBe('access_denied')
    expect(state.inserts).toHaveLength(0)
  })

  it.each([
    ['cross-origin', 'https://evil.example'],
    ['missing Origin', null],
  ])('blocks Allow with %s and issues no code', async (_label, origin) => {
    const res = await post('allow', origin)
    expect(res.status).toBe(403)
    expect(state.inserts).toHaveLength(0)
  })

  it('returns 401 without a session', async () => {
    state.session = { data: null }
    expect((await post('allow')).status).toBe(401)
    expect(state.inserts).toHaveLength(0)
  })
})
