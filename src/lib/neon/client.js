import { neon } from '@neondatabase/serverless'

let cachedSql = null

// Pilot-only Neon client for the commitments module. Isolated from the rest
// of the app, which continues to run entirely on Supabase — see
// src/lib/supabase.js for the production data layer.
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
