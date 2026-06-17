import { useState, useEffect } from 'react'
import { supabase } from '../supabase.js'

export function useAuth() {
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })

    return () => subscription.unsubscribe()
  }, [])

  return { session, loading: session === undefined, user: session?.user ?? null }
}
