import { describe, expect, it } from 'vitest'
import { classify } from './message-route.js'
import type { ServerMessage } from '@hip/protocol'

describe('classify', () => {
  it('marks ready as connect-only', () => {
    expect(classify({ type: 'ready', hasApiKey: true })).toBe('connect-only')
  })

  it('marks *:result as unicast', () => {
    expect(classify({ type: 'session:list:result', sessions: [] })).toBe('unicast')
    expect(classify({ type: 'fs:ls:result', sessionId: 's', path: '/', entries: [] })).toBe('unicast')
    expect(classify({ type: 'memory:list:result', items: [] })).toBe('unicast')
    expect(classify({ type: 'mcp:listResources:result', serverId: 'x', resources: [] })).toBe('unicast')
  })

  it('marks session:loaded and plugin install progress as unicast', () => {
    expect(classify({ type: 'session:loaded', sessionId: 's', messages: [] })).toBe('unicast')
    expect(classify({ type: 'plugin:install:progress', status: 'cloning', message: '…' })).toBe('unicast')
  })

  it('broadcasts lifecycle and streams', () => {
    expect(classify({ type: 'session:created', sessionId: 's' })).toBe('broadcast')
    expect(classify({ type: 'session:deleted', sessionId: 's' })).toBe('broadcast')
    expect(classify({ type: 'session:trashed', sessionId: 's', deletedAt: 1 })).toBe('broadcast')
    expect(
      classify({
        type: 'session:restored',
        sessionId: 's',
        summary: {
          id: 's',
          title: 't',
          preview: '',
          updatedAt: 1,
          messageCount: 0,
          surface: 'chat',
        },
      }),
    ).toBe('broadcast')
    expect(classify({ type: 'token:stream', sessionId: 's', turnId: 't', agentId: 'a', delta: 'x' })).toBe(
      'broadcast',
    )
    expect(
      classify({
        type: 'permission:request',
        sessionId: 's',
        turnId: 't',
        requestId: 'r',
        tool: { title: 'run_script', kind: 'execute' },
        options: [],
      }),
    ).toBe('broadcast')
  })

  it('routes errors by sessionId presence', () => {
    expect(classify({ type: 'error', code: 'X', message: 'm' })).toBe('unicast')
    expect(classify({ type: 'error', sessionId: 's', code: 'X', message: 'm' })).toBe('broadcast')
  })

  it('broadcasts HITL resolve events', () => {
    expect(
      classify({ type: 'permission:resolved', sessionId: 's', requestId: 'r', source: 'cli' }),
    ).toBe('broadcast')
    expect(
      classify({ type: 'agent:interrupt:resolved', sessionId: 's', turnId: 't', source: 'gui' }),
    ).toBe('broadcast')
    expect(classify({ type: 'clients:changed', clients: [] })).toBe('broadcast')
  })
})
