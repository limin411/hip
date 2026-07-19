import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionConfig, ServerMessage } from '@hip/protocol'
import { Session } from './session.js'
import type { SessionStore } from '../persistence/store.js'
import * as agentsIndex from './agents/index.js'

function makeConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return { llmProvider: 'test', model: 'test-model', tools: [], cwd: '/tmp/test-cwd', ...overrides }
}

function mockStore(acpId: string | null = 'acp-old'): SessionStore {
  let acp = acpId
  return {
    setAcpSessionId: vi.fn((_id: string, next: string | null) => {
      acp = next
    }),
    getAcpSessionId: vi.fn(() => acp),
    updateConfig: vi.fn(),
  } as unknown as SessionStore
}

/** Attach store after construct to avoid EventStore/DB wiring. */
function withStore(s: Session, store: SessionStore): Session {
  ;(s as unknown as { store?: SessionStore }).store = store
  return s
}

describe('Session.setAgentId', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('idle switch to ACP: dispose, clear acp id, update config, echo agentChanged', async () => {
    vi.spyOn(agentsIndex, 'readAgentsConfig').mockReturnValue([
      {
        id: 'opencode',
        name: 'OpenCode',
        kind: 'acp',
        command: 'opencode',
        args: ['acp'],
        enabled: true,
      },
    ])
    const store = mockStore('acp-old')
    const s = withStore(new Session('s1', makeConfig({ agentId: undefined })), store)
    const dispose = vi.spyOn(s.agentProv, 'dispose').mockResolvedValue(undefined)
    const sent: ServerMessage[] = []

    const ok = await s.setAgentId('opencode', (m) => sent.push(m))

    expect(ok).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(store.setAcpSessionId).toHaveBeenCalledWith('s1', null)
    expect(store.getAcpSessionId('s1')).toBeNull()
    expect(s.config.agentId).toBe('opencode')
    expect(store.updateConfig).toHaveBeenCalledWith('s1', expect.stringContaining('"agentId":"opencode"'))
    expect(sent).toEqual([{ type: 'session:agentChanged', sessionId: 's1', agentId: 'opencode' }])
  })

  it('clears external agent with builtin / empty and echoes null', async () => {
    vi.spyOn(agentsIndex, 'readAgentsConfig').mockReturnValue([])
    const store = mockStore('acp-x')
    const s = withStore(new Session('s2', makeConfig({ agentId: 'opencode' })), store)
    vi.spyOn(s.agentProv, 'dispose').mockResolvedValue(undefined)
    const sent: ServerMessage[] = []

    expect(await s.setAgentId('builtin', (m) => sent.push(m))).toBe(true)
    expect(s.config.agentId).toBeUndefined()
    expect(store.setAcpSessionId).toHaveBeenCalledWith('s2', null)
    expect(sent.at(-1)).toEqual({ type: 'session:agentChanged', sessionId: 's2', agentId: null })

    s._config = { ...s.config, agentId: 'opencode' }
    sent.length = 0
    expect(await s.setAgentId('', (m) => sent.push(m))).toBe(true)
    expect(s.config.agentId).toBeUndefined()
    expect(sent.at(-1)).toEqual({ type: 'session:agentChanged', sessionId: 's2', agentId: null })
  })

  it('rejects with BUSY while a turn is running', async () => {
    const store = mockStore()
    const s = withStore(new Session('s3', makeConfig()), store)
    s.running = true
    const dispose = vi.spyOn(s.agentProv, 'dispose').mockResolvedValue(undefined)
    const sent: ServerMessage[] = []

    const ok = await s.setAgentId('opencode', (m) => sent.push(m))

    expect(ok).toBe(false)
    expect(dispose).not.toHaveBeenCalled()
    expect(store.setAcpSessionId).not.toHaveBeenCalled()
    expect(sent).toEqual([
      {
        type: 'error',
        sessionId: 's3',
        code: 'BUSY',
        message: 'Cannot change agent while a turn is running',
      },
    ])
  })

  it('rejects unknown / disabled / wrong-kind agent', async () => {
    vi.spyOn(agentsIndex, 'readAgentsConfig').mockReturnValue([
      { id: 'off', name: 'Off', kind: 'acp', command: 'x', args: [], enabled: false },
      { id: 'internal', name: 'In', kind: 'internal', command: 'x', args: [], enabled: true },
    ])
    const store = mockStore()
    const s = withStore(new Session('s4', makeConfig()), store)
    const dispose = vi.spyOn(s.agentProv, 'dispose').mockResolvedValue(undefined)
    const sent: ServerMessage[] = []

    expect(await s.setAgentId('missing', (m) => sent.push(m))).toBe(false)
    expect(await s.setAgentId('off', (m) => sent.push(m))).toBe(false)
    expect(await s.setAgentId('internal', (m) => sent.push(m))).toBe(false)
    expect(dispose).not.toHaveBeenCalled()
    expect(sent.every((m) => m.type === 'error' && (m as { code: string }).code === 'UNKNOWN_AGENT')).toBe(true)
  })

  it('accepts legacy opencode kind', async () => {
    vi.spyOn(agentsIndex, 'readAgentsConfig').mockReturnValue([
      { id: 'legacy', name: 'Legacy', kind: 'opencode', command: 'x', args: [], enabled: true },
    ])
    const store = mockStore()
    const s = withStore(new Session('s5', makeConfig()), store)
    vi.spyOn(s.agentProv, 'dispose').mockResolvedValue(undefined)
    const sent: ServerMessage[] = []

    expect(await s.setAgentId('legacy', (m) => sent.push(m))).toBe(true)
    expect(s.config.agentId).toBe('legacy')
    expect(sent.at(-1)).toMatchObject({ type: 'session:agentChanged', agentId: 'legacy' })
  })
})
