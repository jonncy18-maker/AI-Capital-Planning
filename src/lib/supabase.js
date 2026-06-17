import { createClient } from '@supabase/supabase-js'

// Sanitize copy-paste artifacts that break Supabase requests:
// trailing whitespace/newlines and trailing slashes both produce
// "Invalid path specified in request URL" errors.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
