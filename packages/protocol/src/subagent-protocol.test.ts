import { describe, it, expect } from 'vitest'
import type { AgentRole, AgentConfig, ServerMessage } from './index.js'

describe('sub-agent protocol additions', () => {
  it('AgentRole includes subagent', () => {
    const role: AgentRole = 'subagent'
    expect(role).toBe('subagent')
  })

  it('AgentConfig carries an optional description', () => {
    const a: AgentConfig = {
      id: 'x', name: 'X', kind: 'custom', command: 'c', args: [],
      transport: 'thin', acceptsModelConfig: false, enabled: true,
      description: 'when to use X',
    }
    expect(a.description).toBe('when to use X')
  })

  it('permission:request can carry an agentFrame for nested HITL', () => {
    const msg: Extract<ServerMessage, { type: 'permission:request' }> = {
      type: 'permission:request', sessionId: 's', turnId: 't', requestId: 'r',
      tool: { title: 'edit', kind: 'edit' },                               // real PermissionRequestPayload {title, kind, diff?, content?}
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }], // real PermissionOption {optionId, name, kind}
      agentFrame: { agentId: 'subagent-1', parentAgentId: 'supervisor', name: 'OpenCode' },
    }
    expect(msg.agentFrame?.name).toBe('OpenCode')
  })
})
