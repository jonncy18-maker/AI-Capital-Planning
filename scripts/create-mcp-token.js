#!/usr/bin/env node
// One-time token issuance for the MCP connector (app/api/mcp/route.js).
//
// Run locally, pointed at the real database:
//   DATABASE_URL="<production connection string>" node scripts/create-mcp-token.js you@example.com "Claude Code"
//
// Prints the raw token exactly once — only its SHA-256 hash is stored, so
// there is no way to recover it later. Losing it means creating a new one;
// revoke the old row (`update personal_access_tokens set revoked_at = now()
// where id = '<id>'`) if it's no longer needed.

import { randomBytes, createHash } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const [, , email, name] = process.argv
if (!email) {
  console.error('Usage: node scripts/create-mcp-token.js <account-email> [token name]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — point it at the database this token should grant access to.')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

const [user] = await sql`SELECT id, email FROM neon_auth."user" WHERE email = ${email}`
if (!user) {
  console.error(`No account found with email "${email}".`)
  process.exit(1)
}

const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')
const tokenName = name || 'Claude Code'

const [row] = await sql`
  INSERT INTO personal_access_tokens (user_id, name, token_hash)
  VALUES (${user.id}, ${tokenName}, ${tokenHash})
  RETURNING id, created_at
`

console.log(`Token created for ${user.email} (id ${row.id}, ${row.created_at}).`)
console.log('')
console.log('Save this now — it will not be shown again:')
console.log('')
console.log(token)
