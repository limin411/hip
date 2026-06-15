#!/usr/bin/env node
// Minimal ACP AGENT over stdio for paid-free tests. Uses @agentclientprotocol/sdk's
// AgentSideConnection. Behaviour is scripted via env:
//   MOCK_ACP_THINK=1        -> emit an agent_thought_chunk before the answer
//   MOCK_ACP_TOOL=1         -> emit a tool_call + tool_call_update(completed)
//   MOCK_ACP_PERMISSION=1   -> call session/request_permission before the tool runs
//   MOCK_ACP_AUTH_REQUIRED=1-> newSession throws auth_required until authenticate() is called
//   MOCK_ACP_SLOW_MS=<n>    -> delay between answer chunks (so cancel can land mid-stream)
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'

const env = process.env
let authed = !env.MOCK_ACP_AUTH_REQUIRED
let model = 'mock/base'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const agent = {
  async initialize() {
    return {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      authMethods: env.MOCK_ACP_AUTH_REQUIRED ? [{ id: 'mock-login', name: 'Mock Login' }] : [],
    }
  },
  async authenticate() { authed = true; return {} },
  async newSession() {
    if (!authed) { const e = new Error('auth_required'); e.code = -32000; e.data = { authRequired: true }; throw e }
    return {
      sessionId: 'mock-sess-1',
      configOptions: [{ type: 'select', id: 'model', name: 'Model', category: 'model', currentValue: model,
        options: [{ value: 'mock/base', name: 'Base' }, { value: 'mock/other', name: 'Other' }] }],
    }
  },
  async loadSession(p) {
    // replay one prior turn
    await conn.sessionUpdate({ sessionId: p.sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'prior question' } } })
    await conn.sessionUpdate({ sessionId: p.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'prior answer' } } })
    return {}
  },
  async setSessionConfigOption(p) {
    model = p.value
    return { configOptions: [{ type: 'select', id: 'model', name: 'Model', category: 'model', currentValue: model,
      options: [{ value: 'mock/base', name: 'Base' }, { value: 'mock/other', name: 'Other' }] }] }
  },
  async setSessionMode() { return {} },
  async cancel(p) { cancelled.add(p.sessionId) },
  async prompt(p) {
    const sid = p.sessionId
    cancelled.delete(sid)
    if (env.MOCK_ACP_THINK) await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking… ' } } })
    if (env.MOCK_ACP_PERMISSION) {
      const res = await conn.requestPermission({ sessionId: sid, toolCall: { toolCallId: 't1', title: 'edit hello.txt', kind: 'edit' },
        options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] })
      if (res.outcome?.outcome !== 'selected') return { stopReason: 'cancelled' }
    }
    if (env.MOCK_ACP_TOOL) {
      await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'edit hello.txt', kind: 'edit', status: 'in_progress' } })
      await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'wrote file' } }] } })
    }
    const words = [`answer(${model}): `, 'hello', ' ', 'world']
    for (const w of words) {
      if (cancelled.has(sid)) return { stopReason: 'cancelled' }
      await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: w } } })
      if (env.MOCK_ACP_SLOW_MS) await sleep(Number(env.MOCK_ACP_SLOW_MS))
    }
    return { stopReason: 'end_turn' }
  },
}
const cancelled = new Set()
const conn = new AgentSideConnection(() => agent, ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
