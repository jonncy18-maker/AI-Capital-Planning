import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  validateRedirectUris, sanitizeClientName, isSameOrigin, describeRedirect,
} from '../../src/lib/mcp/oauthPolicy.js'

const sqlMock = vi.fn()
vi.mock('../../src/lib/neon/client.js', () => ({ getNeonSql: () => sqlMock }))
vi.mock('../../src/lib/neon/authServer.js', () => ({
  auth: { getSession: async () => ({ data: { session: null, user: null } }) },
}))
const authMod = await import('../../src/lib/neon/authServer.js')

const CLAUDE_AI = 'https://claude.ai/api/mcp/auth_callback'
const CLAUDE_COM = 'https://claude.com/api/mcp/auth_callback'

describe('validateRedirectUris', () => {
  it('accepts the claude.ai and claude.com callbacks', () => {
    expect(validateRedirectUris([CLAUDE_AI])).toEqual({ ok: true, uris: [CLAUDE_AI] })
    expect(validateRedirectUris([CLAUDE_AI, CLAUDE_COM]).ok).toBe(true)
  })

  it('returns the canonical form of accepted URIs', () => {
    expect(validateRedirectUris(['https://CLAUDE.AI/api/mcp/./auth_callback'])).toEqual({ ok: true, uris: [CLAUDE_AI] })
  })

  it('accepts a ChatGPT connector callback with one alphanumeric id', () => {
    const uri = 'https://chatgpt.com/connector/oauth/JtL22DYxfAQu'
    expect(validateRedirectUris([uri])).toEqual({ ok: true, uris: [uri] })
  })

  it.each([
    ['no id', 'https://chatgpt.com/connector/oauth/'],
    ['no id, no slash', 'https://chatgpt.com/connector/oauth'],
    ['extra segment', 'https://chatgpt.com/connector/oauth/abc/def'],
    ['non-alphanumeric id', 'https://chatgpt.com/connector/oauth/ab-c'],
    ['trailing slash', 'https://chatgpt.com/connector/oauth/abc/'],
    ['query string', 'https://chatgpt.com/connector/oauth/abc?x=1'],
    ['wrong prefix', 'https://chatgpt.com/other/abc'],
    ['lookalike host', 'https://chatgpt.com.evil.example/connector/oauth/abc'],
    ['subdomain', 'https://evil.chatgpt.com/connector/oauth/abc'],
    ['http scheme', 'http://chatgpt.com/connector/oauth/abc'],
  ])('rejects ChatGPT callback with %s', (_label, uri) => {
    expect(validateRedirectUris([uri]).ok).toBe(false)
  })

  it('accepts loopback hosts with ports and paths', () => {
    for (const uri of ['http://127.0.0.1:8080/cb', 'http://localhost:3000/callback', 'http://[::1]:5173/x', 'http://localhost/']) {
      expect(validateRedirectUris([uri]).ok).toBe(true)
    }
  })

  it.each([
    ['http non-loopback', 'http://example.com/cb'],
    ['https other host', 'https://evil.example/api/mcp/auth_callback'],
    ['claude.ai wrong path', 'https://claude.ai/other'],
    ['claude.ai lookalike host', 'https://claude.ai.evil.example/api/mcp/auth_callback'],
    ['query string', `${CLAUDE_AI}?x=1`],
    ['fragment', `${CLAUDE_AI}#frag`],
    ['userinfo', 'https://user@claude.ai/api/mcp/auth_callback'],
    ['loopback userinfo', 'http://user:pw@127.0.0.1/cb'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['unparsable', 'not a url'],
  ])('rejects %s', (_label, uri) => {
    const r = validateRedirectUris([uri])
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe('string')
  })

  it('rejects non-array, empty, too many, and non-string entries', () => {
    expect(validateRedirectUris('x').ok).toBe(false)
    expect(validateRedirectUris(undefined).ok).toBe(false)
    expect(validateRedirectUris([]).ok).toBe(false)
    expect(validateRedirectUris(Array(6).fill(CLAUDE_AI)).ok).toBe(false)
    expect(validateRedirectUris(Array(5).fill(CLAUDE_AI)).ok).toBe(true)
    expect(validateRedirectUris([CLAUDE_AI, 42]).ok).toBe(false)
    expect(validateRedirectUris([null]).ok).toBe(false)
  })
})

describe('sanitizeClientName', () => {
  it('strips control characters and trims', () => {
    expect(sanitizeClientName('  Cla\u0000u\nde\u007f  ')).toBe('Claude')
  })
  it('caps length at 100', () => {
    expect(sanitizeClientName('a'.repeat(250))).toHaveLength(100)
  })
  it('returns null for non-strings and empty results', () => {
    expect(sanitizeClientName(5)).toBeNull()
    expect(sanitizeClientName(undefined)).toBeNull()
    expect(sanitizeClientName('   ')).toBeNull()
    expect(sanitizeClientName('\u0001\u0002')).toBeNull()
  })
})

describe('isSameOrigin', () => {
  const req = (headers) => new Request('https://app.example/api/mcp/authorize', { method: 'POST', headers })
  it('is true only when Origin matches the request origin', () => {
    expect(isSameOrigin(req({ origin: 'https://app.example' }))).toBe(true)
  })
  it('is false on mismatch', () => {
    expect(isSameOrigin(req({ origin: 'https://evil.example' }))).toBe(false)
  })
  it('is false when Origin is absent', () => {
    expect(isSameOrigin(req({}))).toBe(false)
  })
})

describe('describeRedirect', () => {
  it('returns the host', () => {
    expect(describeRedirect('http://localhost:3000/cb')).toEqual({ host: 'localhost:3000', display: 'localhost:3000' })
    expect(describeRedirect(CLAUDE_AI).host).toBe('claude.ai')
  })
  it('falls back to the raw string when unparsable', () => {
    expect(describeRedirect('not a url').host).toBe('not a url')
  })
})

describe('POST /api/mcp/register', () => {
  beforeEach(() => sqlMock.mockReset())
  const post = async (body) => {
    const { POST } = await import('../../app/api/mcp/register/route.js')
    return POST(new Request('https://app.example/api/mcp/register', { method: 'POST', body: JSON.stringify(body) }))
  }

  it('returns 400 invalid_redirect_uri for a bad uri without touching the DB', async () => {
    const res = await post({ redirect_uris: ['https://evil.example/cb'], client_name: 'Claude' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_redirect_uri')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 201 with sanitized name for a good uri', async () => {
    sqlMock.mockResolvedValue([])
    const res = await post({ redirect_uris: [CLAUDE_AI], client_name: ' Claude\n ' })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.client_name).toBe('Claude')
    expect(json.redirect_uris).toEqual([CLAUDE_AI])
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/mcp/authorize', () => {
  beforeEach(() => sqlMock.mockReset())
  const form = new URLSearchParams({ action: 'allow', client_id: 'c', redirect_uri: CLAUDE_AI, code_challenge: 'x' })

  it('returns 403 on cross-origin before any DB call', async () => {
    vi.spyOn(authMod.auth, 'getSession').mockResolvedValueOnce({ data: { session: {}, user: { id: 'u1' } } })
    const { POST } = await import('../../app/api/mcp/authorize/route.js')
    const res = await POST(new Request('https://app.example/api/mcp/authorize', {
      method: 'POST', headers: { origin: 'https://evil.example' }, body: form,
    }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('access_denied')
    expect(sqlMock).not.toHaveBeenCalled()
  })
})
