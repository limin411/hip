import { describe, it, expect } from 'vitest'
import type { ClientMessage, ServerMessage, AcpConfigOption, PermissionRequestPayload } from './index.js'

describe('acp control-plane messages', () => {
  it('types the new server/client messages', () => {
    const req: ServerMessage = { type: 'permission:request', sessionId: 's', turnId: 't', requestId: 'r',
      tool: { title: 'edit', kind: 'edit' }, options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }] }
    const resp: ClientMessage = { type: 'permission:respond', sessionId: 's', requestId: 'r', optionId: 'once' }
    const opts: ServerMessage = { type: 'agent:configOptions', sessionId: 's', options: [] }
    const set: ClientMessage = { type: 'agent:setConfigOption', sessionId: 's', configId: 'model', value: 'mock/other' }
    const o: AcpConfigOption = { id: 'model', name: 'Model', category: 'model', currentValue: 'a', options: [{ value: 'a', name: 'A' }] }
    const p: PermissionRequestPayload = req.type === 'permission:request' ? req.tool : { title: '', kind: 'other' }
    expect([req, resp, opts, set, o, p]).toBeTruthy()
  })
})
