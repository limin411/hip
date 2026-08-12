import { describe, it, expect, beforeEach, vi } from 'vitest'
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
      phase: 'running',
    })
    expect(useTerminalAgentStore.getState().execFlightByTerminal.tm_1?.callId).toBe('c1')
    s.setExecFlight('tm_1', null)
    expect(useTerminalAgentStore.getState().execFlightByTerminal.tm_1).toBeNull()
  })

  it('flips driver to agent on flight start and back to user on clear', () => {
    const s = useTerminalAgentStore.getState()
    s.setExecFlight('tm_1', {
      callId: 'c1',
      sessionId: 's1',
      command: 'df -h',
      startedAt: 1,
      deadline: 2,
      phase: 'running',
    })
    expect(useTerminalAgentStore.getState().driverByTerminal.tm_1).toBe('agent')
    s.setDriver('tm_1', 'user')
    expect(useTerminalAgentStore.getState().driverByTerminal.tm_1).toBe('user')
    s.setExecFlight('tm_1', null)
    expect(useTerminalAgentStore.getState().driverByTerminal.tm_1).toBe('user')
  })

  it('resumeExecFlight extends the deadline by the pause and hands the keyboard back', () => {
    const s = useTerminalAgentStore.getState()
    const startedAt = Date.now()
    s.setExecFlight('tm_1', {
      callId: 'c1',
      sessionId: 's1',
      command: 'sudo apt install -y htop',
      startedAt,
      deadline: startedAt + 5000,
      phase: 'handed_off',
      handedOffAt: startedAt + 1000,
    })
    s.setDriver('tm_1', 'user')
    vi.setSystemTime(startedAt + 3000)
    s.resumeExecFlight('tm_1')
    const f = useTerminalAgentStore.getState().execFlightByTerminal.tm_1
    expect(f?.phase).toBe('resumed')
    // 2s pause is added back: deadline 5000 → 7000 (relative to startedAt).
    expect(f?.deadline).toBe(startedAt + 7000)
    expect(useTerminalAgentStore.getState().driverByTerminal.tm_1).toBe('agent')
    vi.useRealTimers()
  })

  it('resumeExecFlight is a no-op unless the flight is handed_off', () => {
    const s = useTerminalAgentStore.getState()
    s.setExecFlight('tm_1', {
      callId: 'c1',
      sessionId: 's1',
      command: 'df -h',
      startedAt: 1,
      deadline: 2,
      phase: 'running',
    })
    s.resumeExecFlight('tm_1')
    expect(useTerminalAgentStore.getState().execFlightByTerminal.tm_1?.phase).toBe('running')
  })

  it('active session is per-terminal', () => {
    const s = useTerminalAgentStore.getState()
    s.setActiveSession('tm_1', 's1')
    s.setActiveSession('tm_2', 's2')
    expect(s.getActiveSession('tm_1')).toBe('s1')
    expect(s.getActiveSession('tm_2')).toBe('s2')
  })
})
