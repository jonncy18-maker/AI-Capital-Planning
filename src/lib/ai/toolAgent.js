// The full-capability assistant loop.
//
// Generalizes the original scenario-only agent: the model is given the whole
// tool registry, the loop runs in the browser (same as every other DB write in
// this app), and any tool that changes data pauses for explicit confirmation
// before it runs.
//
// Turn shape:
//   read tool calls   → executed immediately, loop continues
//   write tool calls  → loop returns { status: 'pending', pending } and stops
//                       confirmPendingActions() runs them; cancelPendingActions()
//                       tells the model they were declined
//
// A confirmed turn re-enters the same loop, so the model can chain work (look
// something up, write, then summarize) with a confirmation gate at each write.

import { invokeAIChat } from './sendMessage.js'
import { toolSchemas, getTool, buildPreview, executeTool } from './tools/index.js'
import { buildAssistantSystemExtra } from './assistant.prompts.js'

// Tool JSON for a multi-month write is large; keep the ceiling generous or
// Anthropic truncates mid-call (stop_reason 'max_tokens') and the turn returns
// an empty bubble.
const AGENT_MAX_TOKENS = 8000

// Read → write → summarize is three round trips; a few more allow a chained
// change. Past that we stop rather than loop on the model's account.
const MAX_STEPS = 8

const TRUNCATION_MSG =
  'That change was too large to build in one step. Try splitting it into smaller pieces — ' +
  'for example set one category or one year at a time.'

function toolResult(id, payload, isError = false) {
  return { type: 'tool_result', tool_use_id: id, content: JSON.stringify(payload), is_error: isError }
}

function buildContext({ userId, context, activeModule }) {
  return { userId, aiContext: context, categories: context?.categories ?? [], activeModule }
}

async function runReadBlocks(blocks, ctx, onStatus) {
  const results = []
  for (const block of blocks) {
    onStatus?.(`Looking up ${block.input?.resource ?? block.name}…`)
    try {
      const out = await executeTool(block.name, ctx.userId, block.input, ctx)
      results.push(toolResult(block.id, { ok: true, ...(out.result ?? {}) }))
    } catch (e) {
      results.push(toolResult(block.id, { ok: false, error: e.message }, true))
    }
  }
  return results
}

// Core loop. `pendingResults` carries tool_results already computed for the
// first assistant turn (read results stashed at the pause, plus the confirmed
// or cancelled write results) so the model sees one complete result set.
async function runLoop({ messages, ctx, systemExtra, yearTxns, onStatus, created, actions, seedResults }) {
  let msgs = messages
  let step = 0

  if (seedResults?.length) {
    msgs = [...msgs, { role: 'user', content: seedResults }]
  }

  while (step < MAX_STEPS) {
    step += 1
    const res = await invokeAIChat({
      messages: msgs,
      tools: toolSchemas(),
      context: ctx.aiContext,
      yearTxns,
      systemExtra,
      maxTokens: AGENT_MAX_TOKENS,
    })
    if (res.status !== 'ok') return { status: res.status, text: res.text, created, actions }
    if (res.stop_reason === 'max_tokens') return { status: 'error', text: TRUNCATION_MSG, created, actions }

    const messagesWithAI = [...msgs, { role: 'assistant', content: res.content }]

    if (res.stop_reason !== 'tool_use') {
      return { status: 'ok', text: res.text || 'Done.', created, actions }
    }

    const toolBlocks = res.content.filter(b => b.type === 'tool_use')
    const unknown = toolBlocks.filter(b => !getTool(b.name))
    const writeBlocks = toolBlocks.filter(b => getTool(b.name)?.write)
    const readBlocks = toolBlocks.filter(b => getTool(b.name) && !getTool(b.name).write)

    if (writeBlocks.length) {
      // Reads in the same turn are safe to run now; their results are held
      // until the user decides, so the model gets one coherent result set.
      const readResults = await runReadBlocks(readBlocks, ctx, onStatus)
      const unknownResults = unknown.map(b => toolResult(b.id, { ok: false, error: `Unknown tool: ${b.name}` }, true))

      const previews = []
      for (const block of writeBlocks) {
        try {
          previews.push({ blockId: block.id, tool: block.name, ...(await buildPreview(block.name, block.input, ctx)) })
        } catch (e) {
          previews.push({ blockId: block.id, tool: block.name, title: block.name, rows: [], error: e.message })
        }
      }

      return {
        status: 'pending',
        text: res.text || '',
        created,
        actions,
        pending: {
          messagesWithAI,
          writeBlocks,
          heldResults: [...readResults, ...unknownResults],
          previews,
          systemExtra,
        },
      }
    }

    const results = [
      ...(await runReadBlocks(readBlocks, ctx, onStatus)),
      ...unknown.map(b => toolResult(b.id, { ok: false, error: `Unknown tool: ${b.name}` }, true)),
    ]
    msgs = [...messagesWithAI, { role: 'user', content: results }]
  }

  return {
    status: 'ok',
    text: 'Stopped after several steps — some of the work may be incomplete. Check the module directly.',
    created,
    actions,
  }
}

// One user turn. Returns either a text answer, or a pending confirmation.
export async function runAssistant({ userId, history = [], prompt, context, yearTxns, activeModule, onStatus }) {
  const ctx = buildContext({ userId, context, activeModule })
  const systemExtra = buildAssistantSystemExtra({
    categoryNames: (context?.categories ?? []).map(c => c.category).filter(Boolean),
    activeModule,
  })

  const messages = [
    ...history.filter(m => m.content).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt },
  ]

  return runLoop({
    messages, ctx, systemExtra, yearTxns, onStatus, created: [], actions: [], seedResults: null,
  })
}

// Run the writes the user just approved, then let the model summarize.
export async function confirmPendingActions({ userId, pending, context, yearTxns, activeModule, onStatus }) {
  const ctx = buildContext({ userId, context, activeModule })
  const { messagesWithAI, writeBlocks, heldResults, systemExtra } = pending
  const created = []
  const actions = []
  const results = [...(heldResults ?? [])]

  for (const block of writeBlocks) {
    const preview = pending.previews?.find(p => p.blockId === block.id)
    onStatus?.(`${preview?.title ?? block.name}…`)
    try {
      const out = await executeTool(block.name, userId, block.input, ctx)
      if (out?.created) created.push(out.created)
      actions.push({
        tool: block.name,
        group: getTool(block.name)?.group ?? '',
        summary: out?.summary ?? block.name,
        undo: out?.undo ?? null,
      })
      results.push(toolResult(block.id, { ok: true, summary: out?.summary, ...(out?.result ?? {}) }))
    } catch (e) {
      results.push(toolResult(block.id, { ok: false, error: e.message }, true))
    }
  }

  return runLoop({
    messages: messagesWithAI, ctx, systemExtra, yearTxns, onStatus, created, actions, seedResults: results,
  })
}

// Tell the model the writes were declined and get a short acknowledgement.
// No tools on this call, so it cannot immediately propose the same write again.
export async function cancelPendingActions({ pending, context, yearTxns }) {
  const { messagesWithAI, writeBlocks, heldResults, systemExtra } = pending
  const results = [
    ...(heldResults ?? []),
    ...writeBlocks.map(b => toolResult(b.id, { ok: false, error: 'User declined this change before it was saved.' }, true)),
  ]

  const res = await invokeAIChat({
    messages: [...messagesWithAI, { role: 'user', content: results }],
    context,
    yearTxns,
    systemExtra,
    maxTokens: 512,
  })
  return { status: 'ok', text: res.text || 'Cancelled — nothing was saved.', created: [], actions: [] }
}
