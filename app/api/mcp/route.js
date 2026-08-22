import { createHash } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { getNeonSql } from '../../../src/lib/neon/client.js'
import { toolSchemas, getTool, executeTool } from '../../../src/lib/ai/tools/index.js'
import { runAsToken } from '../../../src/lib/db/mcpContext.js'

// Remote MCP connector — gives Claude Code the same 39 tools the in-app
// assistant uses (src/lib/ai/tools/index.js), over the same app/api/**
// routes and validation, authenticated by a personal access token instead
// of a browser session cookie. See ROADMAP.md for the design writeup.
//
// Writes execute immediately on a call — there's no in-app confirmation
// card here, because there's no browser to show one to. The safety gate is
// whatever approval step the connecting Claude client itself uses before
// invoking a tool.

async function resolveToken(request) {
  const header = request.headers.get('authorization') || ''
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const sql = getNeonSql()
  const [row] = await sql`
    SELECT user_id FROM personal_access_tokens
    WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
  `
  if (!row) return null

  // Best-effort — a failed timestamp update should never block the request.
  sql`UPDATE personal_access_tokens SET last_used_at = now() WHERE token_hash = ${tokenHash}`
    .catch(() => {})

  return { userId: row.user_id, token }
}

function toMcpTool(tool) {
  return {
    name: tool.schema.name,
    description: tool.schema.description,
    inputSchema: tool.schema.input_schema,
  }
}

function buildServer(auth) {
  const server = new Server(
    { name: 'ai-capital-planning', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolSchemas().map(s => toMcpTool({ schema: s })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    if (!getTool(name)) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
    try {
      const out = await runAsToken(auth.token, () => executeTool(name, auth.userId, args ?? {}, {}))
      const payload = { summary: out?.summary, ...(out?.result ?? {}) }
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: e.message }], isError: true }
    }
  })

  return server
}

async function handle(request) {
  const auth = await resolveToken(request)
  if (!auth) {
    return Response.json({ error: 'Missing or invalid bearer token.' }, { status: 401 })
  }

  // Fresh server + transport per request — stateless mode, no sticky session
  // needed across Vercel's ephemeral function instances.
  const transport = new WebStandardStreamableHTTPServerTransport()
  const server = buildServer(auth)
  await server.connect(transport)
  return transport.handleRequest(request)
}

export async function POST(request) { return handle(request) }
export async function GET(request) { return handle(request) }
export async function DELETE(request) { return handle(request) }
