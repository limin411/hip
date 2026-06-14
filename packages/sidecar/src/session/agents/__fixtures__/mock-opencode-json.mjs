#!/usr/bin/env node
// Test stand-in for `opencode run --format json`. Emits the real OpenCode part
// shape (captured from opencode 1.17.6): one JSON object per line, outer `type`
// mirroring `part.type`. Covers reasoning, a `task` (subagent) tool running ->
// completed, the final text, and step boundaries — so the bridge's rich mapping
// can be tested without a real (paid) LLM call.
const args = process.argv.slice(2)
const message = args[args.length - 1] ?? ''
const sid = 'ses_test'
const mid = 'msg_test'
const w = (o) => process.stdout.write(JSON.stringify(o) + '\n')

if (args.includes('--format') && args[args.indexOf('--format') + 1] === 'json') {
  w({ type: 'step_start', sessionID: sid, part: { id: 'prt_s', messageID: mid, sessionID: sid, type: 'step-start' } })
  w({ type: 'reasoning', sessionID: sid, part: { id: 'prt_r', messageID: mid, sessionID: sid, type: 'reasoning', text: 'thinking about ' + message } })
  w({ type: 'tool', sessionID: sid, part: { id: 'prt_t', callID: 'call_1', messageID: mid, sessionID: sid, type: 'tool', tool: 'task', state: { status: 'running', input: { description: 'spawn subagent' } } } })
  w({ type: 'tool', sessionID: sid, part: { id: 'prt_t', callID: 'call_1', messageID: mid, sessionID: sid, type: 'tool', tool: 'task', state: { status: 'completed', input: { description: 'spawn subagent' }, output: 'subagent done' } } })
  w({ type: 'text', sessionID: sid, part: { id: 'prt_x', messageID: mid, sessionID: sid, type: 'text', text: 'reply to: ' + message } })
  w({ type: 'step_finish', sessionID: sid, part: { id: 'prt_f', messageID: mid, sessionID: sid, type: 'step-finish', tokens: { total: 1, input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 } })
} else {
  process.stdout.write('reply to: ' + message)
}
