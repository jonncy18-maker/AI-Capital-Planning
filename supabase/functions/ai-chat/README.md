# ai-chat Edge Function

Server-side proxy to the Anthropic API. Keeps the Anthropic key out of the browser.

## Deploy

```bash
# From repo root, with the Supabase CLI installed and the project linked:
supabase functions deploy ai-chat

# Set the API key secret (the function reads ANTHROPIC_API_KEY):
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

> If your Supabase secret is named something other than `ANTHROPIC_API_KEY`,
> either rename it or update `Deno.env.get('ANTHROPIC_API_KEY')` in `index.ts`.

## How the app calls it

The frontend never touches the key. `src/lib/ai/sendMessage.js` calls:

```js
supabase.functions.invoke('ai-chat', { body: { system, messages, maxTokens } })
```

`functions.invoke` automatically attaches the signed-in user's JWT, which Supabase
verifies at the gateway — so only authenticated users can reach the function.

## Request body

```json
{
  "system": "system prompt string",
  "messages": [{ "role": "user", "content": "..." }],
  "maxTokens": 1024
}
```

## Response

```json
{ "text": "model response" }
```

On failure: `{ "error": "message" }` with a non-200 status.

## Security note

Once this function is confirmed working, ensure the old browser-side path is dead:
keep the GitHub `VITE_ANTHROPIC_API_KEY` secret empty and rotate the key if a real
one was ever exposed there. `src/lib/anthropic.js` (direct browser call) is retained
only for reference and should not be used.
