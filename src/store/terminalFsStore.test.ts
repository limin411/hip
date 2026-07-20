import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalFsStore } from './terminalFsStore'

describe('terminalFsStore', () => {
  beforeEach(() => {
    useTerminalFsStore.setState({ byTerminal: {}, transfers: [] })
  })

  it('stores entries and clears by terminal', () => {
    useTerminalFsStore.getState().setRootPath('tm_a', '/home/u')
    useTerminalFsStore.getState().setEntries('tm_a', '/home/u', [
      { name: 'f.txt', path: '/home/u/f.txt', isDir: false, size: 1 },
    ])
    expect(useTerminalFsStore.getState().byTerminal.tm_a?.rootPath).toBe('/home/u')
    expect(useTerminalFsStore.getState().byTerminal.tm_a?.entriesByDir['/home/u']).toHaveLength(1)

    useTerminalFsStore.getState().upsertTransfer({
      opId: 'op1',
      terminalId: 'tm_a',
      kind: 'download',
      label: 'f.txt',
      phase: 'progress',
      bytes: 10,
      total: 100,
    })
    expect(useTerminalFsStore.getState().transfers).toHaveLength(1)

    useTerminalFsStore.getState().clearTerminal('tm_a')
    expect(useTerminalFsStore.getState().byTerminal.tm_a).toBeUndefined()
    expect(useTerminalFsStore.getState().transfers).toHaveLength(0)
  })

  it('toggleExpanded flips dir state', () => {
    useTerminalFsStore.getState().toggleExpanded('tm_b', '/x')
    expect(useTerminalFsStore.getState().byTerminal.tm_b?.expanded['/x']).toBe(true)
    useTerminalFsStore.getState().toggleExpanded('tm_b', '/x')
    expect(useTerminalFsStore.getState().byTerminal.tm_b?.expanded['/x']).toBe(false)
  })
})
