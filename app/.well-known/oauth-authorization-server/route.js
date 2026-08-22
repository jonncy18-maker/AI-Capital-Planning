// OAuth Authorization Server Metadata (RFC 8414) — lets a client (claude.ai's
// connector setup) discover the authorize/token/register endpoints instead
// of them being hand-configured.
export async function GET(request) {
  const issuer = new URL(request.url).origin
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/api/mcp/authorize`,
    token_endpoint: `${issuer}/api/mcp/token`,
    registration_endpoint: `${issuer}/api/mcp/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  })
}
