// src/domain/terminalLifecycle.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const order: string[] = []
  const mk = (name: string) =>
    vi.fn((id: string) => {
      order.push(`${name}:${id}`)
    })
  return {
    order,
    ensureSession: mk('ensureSession'),
    clearSession: mk('clearSession'),
    getSession: vi.fn(() => ({ generation: 0 })),
    setGeneration: mk('setGeneration'),
    clearTerminal: mk('clearTerminal'),
    setExecFlight: mk('setExecFlight'),
    setActiveSession: mk('setActiveSession'),
    pushRecent: vi.fn(async () => {}),
    removeTerminalRecord: vi.fn(async () => {}),
    upsertTerminalRecord: vi.fn(async () => {}),
  }
})

vi.mock('@/store/terminalStore', () => ({
  useTerminalStore: {
    getState: () => ({
      ensureSession: h.ensureSession,
      clearSession: h.clearSession,
      getSession: h.getSession,
      setGeneration: h.setGeneration,
    }),
  },
}))

vi.mock('@/store/terminalFsStore', () => ({
  useTerminalFsStore: {
    getState: () => ({ clearTerminal: h.clearTerminal }),
  },
}))

vi.mock('@/store/terminalAgentStore', () => ({
  useTerminalAgentStore: {
    getState: () => ({
      setExecFlight: h.setExecFlight,
      setActiveSession: h.setActiveSession,
    }),
  },
}))

vi.mock('@/store/terminalHostStore', () => ({
  useTerminalHostStore: {
    getState: vi.fn(() => ({
      pushRecent: h.pushRecent,
      removeTerminalRecord: h.removeTerminalRecord,
      upsertTerminalRecord: h.upsertTerminalRecord,
    })),
  },
}))

import { useTerminalHostStore } from '@/store/terminalHostStore'
import type { ManagedTerminal } from '../store/managedTerminalStore'
import {
  disposeTerminal,
  ensureTerminalSession,
  persistSshRecord,
  recordTerminalLaunch,
  removeHostTerminalRecord,
  resetTerminalForReconnect,
} from './terminalLifecycle'

function sshTerm(over: Partial<ManagedTerminal> = {}): ManagedTerminal {
  return {
    id: 'tm_1',
    kind: 'ssh',
    title: 'ops',
    hostId: 'hst_1',
    remotePath: '/srv',
    status: 'disconnected',
    createdAt: 5,
    ...over,
  }
}

beforeEach(() => {
  h.order.length = 0
  for (const fn of [
    h.ensureSession,
    h.clearSession,
    h.clearTerminal,
    h.setExecFlight,
    h.setActiveSession,
    h.pushRecent,
    h.removeTerminalRecord,
    h.upsertTerminalRecord,
  ]) {
    fn.mockClear()
  }
})

describe('disposeTerminal', () => {
  it('clears ring → fs cache → agent exec → active session (order contract)', () => {
    disposeTerminal('tm_1')
    expect(h.order).toEqual([
      'clearSession:tm_1',
      'clearTerminal:tm_1',
      'setExecFlight:tm_1',
      'setActiveSession:tm_1',
    ])
  })

  it('clearAgent:false skips agent state (SSH !term close path)', () => {
    disposeTerminal('tm_1', { clearAgent: false })
    expect(h.order).toEqual(['clearSession:tm_1', 'clearTerminal:tm_1'])
    expect(h.setExecFlight).not.toHaveBeenCalled()
    expect(h.setActiveSession).not.toHaveBeenCalled()
  })

  it('clearAgent:true explicitly keeps agent clearing', () => {
    disposeTerminal('tm_1', { clearAgent: true })
    expect(h.order).toHaveLength(4)
    expect(h.setActiveSession).toHaveBeenCalledWith('tm_1', null)
  })
})

describe('ensureTerminalSession', () => {
  it('delegates to ring ensureSession', () => {
    ensureTerminalSession('tm_2')
    expect(h.ensureSession).toHaveBeenCalledWith('tm_2')
    expect(h.order).toEqual(['ensureSession:tm_2'])
  })
})

describe('resetTerminalForReconnect', () => {
  it('clears residue then rebuilds ring with a bumped generation, resetting exec flight only (no setActiveSession)', () => {
    h.getSession.mockReturnValue({ generation: 2 })
    resetTerminalForReconnect('tm_1')
    expect(h.order).toEqual([
      'clearSession:tm_1',
      'ensureSession:tm_1',
      'setGeneration:tm_1',
      'clearTerminal:tm_1',
      'setExecFlight:tm_1',
    ])
    expect(h.setGeneration).toHaveBeenCalledWith('tm_1', 3)
    expect(h.setActiveSession).not.toHaveBeenCalled()
  })
})

describe('recordTerminalLaunch', () => {
  it('maps local opts and stamps at', async () => {
    await recordTerminalLaunch({ type: 'local', cwd: '/tmp/x', label: 'X' })
    expect(h.pushRecent).toHaveBeenCalledWith({
      type: 'local',
      cwd: '/tmp/x',
      label: 'X',
      at: expect.any(Number),
    })
  })

  it('maps ssh opts and stamps at', async () => {
    await recordTerminalLaunch({ type: 'ssh', hostId: 'hst_1', label: 'ops' })
    expect(h.pushRecent).toHaveBeenCalledWith({
      type: 'ssh',
      hostId: 'hst_1',
      label: 'ops',
      at: expect.any(Number),
    })
  })
})

describe('removeHostTerminalRecord', () => {
  it('delegates to host catalog removeTerminalRecord', async () => {
    await removeHostTerminalRecord('tm_1')
    expect(h.removeTerminalRecord).toHaveBeenCalledWith('tm_1')
  })

  it('tolerates missing removeTerminalRecord (optional chain)', async () => {
    vi.mocked(useTerminalHostStore.getState).mockReturnValueOnce({
      pushRecent: h.pushRecent,
      upsertTerminalRecord: h.upsertTerminalRecord,
    } as never)
    await expect(removeHostTerminalRecord('tm_1')).resolves.toBeUndefined()
  })
})

describe('persistSshRecord', () => {
  it('upserts the catalog record for ssh terminals', () => {
    persistSshRecord(sshTerm())
    expect(h.upsertTerminalRecord).toHaveBeenCalledWith({
      id: 'tm_1',
      hostId: 'hst_1',
      title: 'ops',
      remotePath: '/srv',
      status: 'disconnected',
      createdAt: 5,
    })
  })

  it('no-ops for local terminals', () => {
    persistSshRecord(sshTerm({ kind: 'local' }))
    expect(h.upsertTerminalRecord).not.toHaveBeenCalled()
  })

  it('no-ops for ssh terminals without a hostId', () => {
    persistSshRecord(sshTerm({ hostId: undefined }))
    expect(h.upsertTerminalRecord).not.toHaveBeenCalled()
  })

  it('tolerates missing upsertTerminalRecord (optional chain)', () => {
    vi.mocked(useTerminalHostStore.getState).mockReturnValueOnce({
      pushRecent: h.pushRecent,
      removeTerminalRecord: h.removeTerminalRecord,
    } as never)
    expect(() => persistSshRecord(sshTerm())).not.toThrow()
  })
})
