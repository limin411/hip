import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const listen = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...a: unknown[]) => listen(...a),
}))

vi.mock('@/store/terminalStore', () => ({
  useTerminalStore: {
    getState: () => mockStore,
  },
}))

const appendRing = vi.fn()
const setExit = vi.fn()
const mockStore = { appendRing, setExit }

// TextDecoder stream mode is used in bridge — ensure happy-dom has it.

import {
  decodePtyDataB64,
  ptyKill,
  ptyOpen,
  ptyResize,
  ptyWrite,
  startPtyBridge,
} from './pty'

beforeEach(() => {
  invoke.mockReset()
  listen.mockReset()
  appendRing.mockReset()
  setExit.mockReset()
})

describe('decodePtyDataB64', () => {
  it('decodes utf-8 text', () => {
    const b64 = btoa('hello')
    expect(decodePtyDataB64(b64)).toBe('hello')
  })

  it('returns empty on invalid base64', () => {
    expect(decodePtyDataB64('%%%')).toBe('')
  })
})

describe('pty IPC wrappers', () => {
  it('ptyOpen invokes with camelCase args', async () => {
    invoke.mockResolvedValueOnce({ reused: false, generation: 3 })
    await expect(ptyOpen('s1', '/tmp', 80, 24)).resolves.toEqual({ reused: false, generation: 3 })
    expect(invoke).toHaveBeenCalledWith('pty_open', {
      sessionId: 's1',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    })
  })

  it('ptyWrite / ptyResize / ptyKill invoke correctly', async () => {
    invoke.mockResolvedValue(undefined)
    await ptyWrite('s1', 'a')
    await ptyResize('s1', 100, 40)
    await ptyKill('s1')
    expect(invoke).toHaveBeenCalledWith('pty_write', { sessionId: 's1', data: 'a' })
    expect(invoke).toHaveBeenCalledWith('pty_resize', { sessionId: 's1', cols: 100, rows: 40 })
    expect(invoke).toHaveBeenCalledWith('pty_kill', { sessionId: 's1' })
  })
})

describe('startPtyBridge', () => {
  it('registers listeners and only mutates store (no Terminal)', async () => {
    const un1 = vi.fn()
    const un2 = vi.fn()
    let dataHandler: ((e: { payload: { sessionId: string; data: string } }) => void) | undefined
    let exitHandler: ((e: { payload: { sessionId: string; code: number | null; generation?: number } }) => void) | undefined

    listen.mockImplementation(async (event: string, cb: (e: unknown) => void) => {
      if (event === 'pty:data') dataHandler = cb as typeof dataHandler
      if (event === 'pty:exit') exitHandler = cb as typeof exitHandler
      return event === 'pty:data' ? un1 : un2
    })

    const stop = await startPtyBridge()
    expect(listen).toHaveBeenCalledWith('pty:data', expect.any(Function))
    expect(listen).toHaveBeenCalledWith('pty:exit', expect.any(Function))

    dataHandler?.({ payload: { sessionId: 's1', data: btoa('out') } })
    expect(appendRing).toHaveBeenCalledWith('s1', 'out')

    exitHandler?.({ payload: { sessionId: 's1', code: 0, generation: 7 } })
    expect(setExit).toHaveBeenCalledWith('s1', 0, 7)

    stop()
    expect(un1).toHaveBeenCalled()
    expect(un2).toHaveBeenCalled()
  })
})
