import { describe, it, expect, beforeEach } from 'vitest'
import type { SessionConfig } from '@hip/protocol'
import { terminalSessionsFor, useTerminalAgentStore } from './terminalAgentStore'

function session(id: string, surface: SessionConfig['surface'], tmId?: string) {
  return {
    id,
    config: { surface, managedTerminalId: tmId } as SessionConfig,
    title: id,
    updatedAtMs: Number(id.slice(1)),
  }
}

describe('terminalSessionsFor (1:N filter)', () => {
  it('returns only terminal sessions bound to the terminal, newest first', () => {
    const list = [
      session('s1', 'chat'),
      session('s2', 'terminal', 'tm_a'),
      session('s3', 'code'),
      session('s4', 'terminal', 'tm_b'),
      session('s5', 'terminal', 'tm_a'),
    ]
    const out = terminalSessionsFor(list, 'tm_a')
    expect(out.map((s) => s.id)).toEqual(['s5', 's2'])
  })

  it('returns empty for local terminals / unknown ids', () => {
    expect(terminalSessionsFor([session('s1', 'terminal', 'tm_a')], 'tm_z')).toEqual([])
  })
})

describe('terminalAgentStore exec flight (single-flight lock)', () => {
  beforeEach(() => {
    useTerminalAgentStore.setState({ execFlightByTerminal: {} })
  })

  it('stores one flight per terminal', () => {
    const s = useTerminalAgentStore.getState()
    s.setExecFlight('tm_1', {
      callId: 'c1',
      sessionId: 's1',
      command: 'df -h',
      startedAt: 1,
      deadline: 2,
    })
    expect(useTerminalAgentStore.getState().execFlightByTerminal.tm_1?.callId).toBe('c1')
    s.setExecFlight('tm_1', null)
    expect(useTerminalAgentStore.getState().execFlightByTerminal.tm_1).toBeNull()
  })

  it('active session is per-terminal', () => {
    const s = useTerminalAgentStore.getState()
    s.setActiveSession('tm_1', 's1')
    s.setActiveSession('tm_2', 's2')
    expect(s.getActiveSession('tm_1')).toBe('s1')
    expect(s.getActiveSession('tm_2')).toBe('s2')
  })
})
