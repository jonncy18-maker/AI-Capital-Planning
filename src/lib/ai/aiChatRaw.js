// Raw client for the `/api/ai-chat` Vercel route (app/api/ai-chat/route.js)
// that preserves the exact return contract of the old
// `supabase.functions.invoke('ai-chat', { body })` — it resolves to
// `{ data, error }`, where `data` is the parsed JSON response and `error` is
// non-null only on a transport/HTTP failure. The AI parser modules
// (accountParser, billParser, creditCardParser, categoryMapper, …) destructure
// `{ data, error }` and branch on `data?.error`, so swapping the transport here
// needs no change to any caller's response handling.
//
// The session is read server-side from the Neon Auth cookie (sent via
// `credentials: 'include'`); the Anthropic key never reaches the browser.
export async function invokeAIChatRaw(body) {
  let res
  try {
    res = await fetch('/api/ai-chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    // Network/CORS failure — mirror supabase-js, which surfaces this as `error`.
    return { data: null, error: err }
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    // non-JSON body; leave data null and let the status check below handle it
  }

  if (!res.ok) {
    return { data, error: new Error(data?.error || res.statusText || `HTTP ${res.status}`) }
  }

  return { data, error: null }
}
