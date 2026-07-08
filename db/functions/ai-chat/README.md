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
  "maxTokens": 1024,
  "modelFamily": "haiku",
  "cacheSystem": true
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `messages` | yes | Anthropic messages array |
| `system` | no | System prompt string |
| `maxTokens` | no | Defaults to 1024 |
| `modelFamily` | no | `"haiku"` or `"sonnet"` — resolved to the **newest** model in that family at request time. Defaults to `sonnet`. |
| `model` | no | Pin an exact model ID; overrides `modelFamily`. |
| `cacheSystem` | no | When `true`, marks the system prompt for prompt caching (use when the same system/context is reused across requests in a session). |
| `tools` | no | Anthropic tool definitions. When provided, the assistant can request a tool call; the **client** runs the tool loop (see `src/lib/ai/scenarioAgent.js`) and sends `tool_result` turns back. |

> **Redeploy required for AI scenario creation.** The tool-use response fields
> (`content`, `stop_reason`) and `tools` passthrough were added in this version —
> run `supabase functions deploy ai-chat` so the AI can actually build scenarios.
> Until redeployed, the assistant still answers but only *describes* the steps.

### Model resolution

The function calls the Anthropic Models API and floats each family to its newest
available model (cached ~6h per warm instance). If the Models API is unreachable
it falls back to pinned IDs in `MODEL_FALLBACKS` (`index.ts`). When a new major
model ships (e.g. Haiku 5) it is adopted automatically — spot-check one import
afterward, since `suggestBuckets` parses the model's JSON output.

Current routing (see `src/lib/ai/models.js`): group mapping → Haiku,
command bar / AI briefing → Sonnet.

## Response

```json
{ "text": "model response", "content": [ /* raw Anthropic content blocks */ ], "stop_reason": "end_turn" }
```

`text` is the concatenated text blocks (simple callers use just this). `content`
and `stop_reason` let the client drive multi-step tool use (e.g. `stop_reason:
"tool_use"`). On failure: `{ "error": "message" }` with a non-200 status.

## Security note

Once this function is confirmed working, ensure the old browser-side path is dead:
keep the GitHub `VITE_ANTHROPIC_API_KEY` secret empty and rotate the key if a real
one was ever exposed there. `src/lib/anthropic.js` (direct browser call) is retained
only for reference and should not be used.
