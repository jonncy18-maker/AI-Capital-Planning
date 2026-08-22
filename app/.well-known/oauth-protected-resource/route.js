// OAuth Protected Resource Metadata (RFC 9728) — the MCP authorization spec
// has clients discover this first from the resource server (app/api/mcp),
// which then points them at the authorization server metadata above. Both
// roles live in this same app, so it just points back at this origin.
export async function GET(request) {
  const issuer = new URL(request.url).origin
  return Response.json({
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
  })
}
