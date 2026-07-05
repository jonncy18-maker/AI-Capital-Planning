import { neon } from '@neondatabase/serverless'

let cachedSql = null

// Shared Neon client used by every app/api/** route.
export function getNeonSql() {
  if (cachedSql) return cachedSql

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'Missing DATABASE_URL environment variable. Required for the Neon commitments pilot (src/lib/neon).'
    )
  }

  cachedSql = neon(connectionString)
  return cachedSql
}
