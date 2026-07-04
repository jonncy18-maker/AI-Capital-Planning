import { createClient } from '@supabase/supabase-js'

// Sanitize copy-paste artifacts that break Supabase requests. Pasting the
// REST endpoint (…supabase.co/rest/v1) or leaving a trailing slash both
// produce "Invalid path specified in request URL" errors — strip the known
// API path suffixes and any trailing slashes/whitespace.
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '')
  .trim()
  .replace(/\/(rest|auth|storage|realtime|functions)\/v\d+\/?$/, '')
  .replace(/\/+$/, '')
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim()

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
