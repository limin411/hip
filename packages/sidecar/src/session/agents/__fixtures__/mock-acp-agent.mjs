#!/usr/bin/env node
// Minimal ACP AGENT over stdio for paid-free tests. Uses @agentclientprotocol/sdk's
// AgentSideConnection. Behaviour is scripted via env:
//   MOCK_ACP_THINK=1        -> emit an agent_thought_chunk before the answer
//   MOCK_ACP_TOOL=1         -> emit a tool_call + tool_call_update(completed)
//   MOCK_ACP_PERMISSION=1   -> call session/request_permission before the tool runs
//   MOCK_ACP_AUTH_REQUIRED=1-> newSession throws auth_required until authenticate() is called
//   MOCK_ACP_SLOW_MS=<n>    -> delay between answer chunks (so cancel can land mid-stream)
//   MOCK_ACP_PLAN=1         -> emit a plan sessionUpdate before the answer
//   MOCK_ACP_MODELS_ONLY=1  -> session/new returns models{} instead of configOptions (Grok-style)
//   MOCK_ACP_NO_SET_CONFIG=1-> setSessionConfigOption throws method-not-found (Grok-style fallback)
//   MOCK_ACP_CLOSE_SLOW_MS=<n> -> delay closeSession so await dispose settles after close RPC
//   MOCK_ACP_NO_CLOSE=1     -> omit sessionCapabilities.close (no session/close method)
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'
import { Readable, Writable, Transform } from 'node:stream'

const env = process.env
let authed = !env.MOCK_ACP_AUTH_REQUIRED
let model = 'mock/base'
let modelEffort = 'high'
let sessionSeq = 0 // distinct id per newSession (first is 'mock-sess-1')
let cancelled = new Set()
let resumed = new Set()
/** Sessions still open (not closed). */
const open = new Set()
/** Sessions that received session/close (for dispose settle tests). */
const closed = new Set()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function resetState() {
  cancelled.clear()
  resumed.clear()
  open.clear()
  closed.clear()
  sessionSeq = 0
}

// Intercept control messages on stdin before they reach the ACP connection.
let stdinBuffer = ''
const stdinFilter = new Transform({
  transform(chunk, _encoding, callback) {
    stdinBuffer += chunk.toString('utf8')
    let nl
    while ((nl = stdinBuffer.indexOf('\n')) !== -1) {
      const line = stdinBuffer.slice(0, nl)
      stdinBuffer = stdinBuffer.slice(nl + 1)
      if (line.trim() === '{"reset":true}') {
        resetState()
      } else {
        this.push(line + '\n')
      }
    }
    callback()
  },
})
process.stdin.pipe(stdinFilter)

const agent = {
  async initialize() {
    const agentCapabilities = {
      loadSession: true,
      // Advertise session/close unless MOCK_ACP_NO_CLOSE (tests host gate).
      ...(env.MOCK_ACP_NO_CLOSE ? {} : { sessionCapabilities: { close: {} } }),
    }
    return {
      protocolVersion: 1,
      agentCapabilities,
      authMethods: env.MOCK_ACP_AUTH_REQUIRED ? [{ id: 'mock-login', name: 'Mock Login' }] : [],
    }
  },
  async authenticate() { authed = true; return {} },
  async newSession() {
    if (!authed) { const e = new Error('auth_required'); e.code = -32000; e.data = { authRequired: true }; throw e }
    const sessionId = `mock-sess-${++sessionSeq}`
    open.add(sessionId)
    closed.delete(sessionId)
    if (env.MOCK_ACP_MODELS_ONLY) {
      return {
        sessionId,
        models: {
          currentModelId: model,
          availableModels: [
            { modelId: 'mock/base', name: 'Base', _meta: { reasoningEffort: 'high', reasoningEfforts: [
              { id: 'high', value: 'high', label: 'High', default: true },
              { id: 'low', value: 'low', label: 'Low', default: false },
            ] } },
            { modelId: 'mock/other', name: 'Other' },
          ],
        },
      }
    }
    return {
      sessionId,
      configOptions: [{ type: 'select', id: 'model', name: 'Model', category: 'model', currentValue: model,
        options: [{ value: 'mock/base', name: 'Base' }, { value: 'mock/other', name: 'Other' }] }],
    }
  },
  async loadSession(p) {
    resumed.add(p.sessionId) // mark so a later prompt's answer is prefixed 'resumed(...)' — proves load ran
    open.add(p.sessionId)
    // replay one prior turn
    await conn.sessionUpdate({ sessionId: p.sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'prior question' } } })
    await conn.sessionUpdate({ sessionId: p.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'prior answer' } } })
    return {}
  },
  async closeSession(p) {
    if (env.MOCK_ACP_CLOSE_SLOW_MS) await sleep(Number(env.MOCK_ACP_CLOSE_SLOW_MS))
    open.delete(p.sessionId)
    closed.add(p.sessionId)
    return {}
  },
  async setSessionConfigOption(p) {
    if (env.MOCK_ACP_NO_SET_CONFIG) {
      const e = new Error('Method not found')
      e.code = -32601
      throw e
    }
    model = p.value
    return { configOptions: [{ type: 'select', id: 'model', name: 'Model', category: 'model', currentValue: model,
      options: [{ value: 'mock/base', name: 'Base' }, { value: 'mock/other', name: 'Other' }] }] }
  },
  async setSessionMode(p) {
    // Grok Build maps effort selector id "mode" → session/set_mode
    if (p?.modeId) modelEffort = p.modeId
    return {}
  },
  async extMethod(method, params) {
    // Grok Build: session/set_model is an extension method, not set_config_option
    if (method === 'session/set_model') {
      if (!params?.modelId) {
        const e = new Error('Invalid params'); e.code = -32602; throw e
      }
      model = params.modelId
      return { _meta: { model: { Ok: model } } }
    }
    const e = new Error('Method not found'); e.code = -32601; throw e
  },
  async cancel(p) { cancelled.add(p.sessionId) },
  async prompt(p) {
    const sid = p.sessionId
    if (closed.has(sid) && !open.has(sid)) {
      const e = new Error('session closed'); e.code = -32000; throw e
    }
    cancelled.delete(sid)
    if (env.MOCK_ACP_THINK) await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking… ' } } })
    if (env.MOCK_ACP_PLAN) {
      await conn.sessionUpdate({
        sessionId: sid,
        update: {
          sessionUpdate: 'plan',
          entries: [
            { content: 'step one', status: 'completed', priority: 'high' },
            { content: 'step two', status: 'in_progress', priority: 'medium' },
          ],
        },
      })
    }
    if (env.MOCK_ACP_PERMISSION) {
      const res = await conn.requestPermission({ sessionId: sid, toolCall: { toolCallId: 't1', title: 'edit hello.txt', kind: 'edit', content: [{ type: 'diff', path: 'hello.txt', oldText: '', newText: 'hi' }] },
        options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] })
      if (res.outcome?.outcome !== 'selected') return { stopReason: 'cancelled' }
    }
    if (env.MOCK_ACP_TOOL) {
      await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'edit hello.txt', kind: 'edit', status: 'in_progress' } })
      await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'wrote file' } }] } })
    }
    const words = [`${resumed.has(sid) ? 'resumed' : 'answer'}(${model}): `, 'hello', ' ', 'world']
    for (const w of words) {
      if (cancelled.has(sid)) return { stopReason: 'cancelled' }
      await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: w } } })
      if (env.MOCK_ACP_SLOW_MS) await sleep(Number(env.MOCK_ACP_SLOW_MS))
    }
    return { stopReason: 'end_turn' }
  },
  // Grok-style extension: session/set_model is not part of base Agent interface —
  // exercised via ClientSideConnection.extMethod from the hip side; mock does not need it
  // unless we wire a custom JSON-RPC handler. Model switches under MOCK_ACP_NO_SET_CONFIG
  // still update local optimistic options; prompt continues to echo `model` set by standard path.
}
const conn = new AgentSideConnection(() => agent, ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(stdinFilter)))
