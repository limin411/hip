import { describe, it, expect } from 'vitest'
import type { ClientMessage, ServerMessage, AcpConfigOption } from './index.js'
import { parseClientMessage } from './message-guard.js'

// NOTE on coverage: vitest (esbuild) strips TS types, so these annotations are NOT type-checked here.
// The type CONTRACT is enforced where it is consumed — the sidecar's `tsc --noEmit` checks session.ts
// (which constructs permission:request / agent:configOptions) and session-manager.ts (which routes
// permission:respond / agent:setConfigOption). These runtime assertions guard the message SHAPE
// (discriminants + payload fields survive serialization), which is what the WS transport relies on.
describe('acp control-plane messages', () => {
  it('permission:request survives JSON round-trip with its tool payload + options', () => {
    const req: ServerMessage = { type: 'permission:request', sessionId: 's', turnId: 't', requestId: 'r',
      tool: { title: 'edit hello.txt', kind: 'edit', diff: { path: 'hello.txt', oldText: '', newText: 'hi' } },
      options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }] }
    const rt = JSON.parse(JSON.stringify(req)) as Extract<ServerMessage, { type: 'permission:request' }>
    expect(rt.type).toBe('permission:request')
    expect(rt.tool.diff?.path).toBe('hello.txt')
    expect(rt.options[0].optionId).toBe('once')
  })

  it('permission:respond carries either an optionId or cancelled', () => {
    const allow: ClientMessage = { type: 'permission:respond', sessionId: 's', requestId: 'r', optionId: 'once' }
    const cancel: ClientMessage = { type: 'permission:respond', sessionId: 's', requestId: 'r', cancelled: true }
    expect((allow as { optionId?: string }).optionId).toBe('once')
    expect((cancel as { cancelled?: boolean }).cancelled).toBe(true)
  })

  it('agent:configOptions / setConfigOption + AcpConfigOption keep their fields', () => {
    const o: AcpConfigOption = { id: 'model', name: 'Model', category: 'model', currentValue: 'a', options: [{ value: 'a', name: 'A' }] }
    const opts: ServerMessage = { type: 'agent:configOptions', sessionId: 's', options: [o] }
    const set: ClientMessage = { type: 'agent:setConfigOption', sessionId: 's', configId: 'model', value: 'mock/other' }
    const rt = JSON.parse(JSON.stringify(opts)) as Extract<ServerMessage, { type: 'agent:configOptions' }>
    expect(rt.options[0].category).toBe('model')
    expect(rt.options[0].options[0].value).toBe('a')
    expect((set as { configId: string }).configId).toBe('model')
  })

  it('session:setAgent / session:agentChanged round-trip (field-echo)', () => {
    const set: ClientMessage = { type: 'session:setAgent', sessionId: 's', agentId: 'opencode' }
    const echo: ServerMessage = { type: 'session:agentChanged', sessionId: 's', agentId: 'opencode' }
    const clear: ServerMessage = { type: 'session:agentChanged', sessionId: 's', agentId: null }
    expect(JSON.parse(JSON.stringify(set))).toEqual(set)
    expect(JSON.parse(JSON.stringify(echo))).toEqual(echo)
    expect(JSON.parse(JSON.stringify(clear))).toEqual(clear)
    expect(parseClientMessage(set)?.type).toBe('session:setAgent')
  })
})
