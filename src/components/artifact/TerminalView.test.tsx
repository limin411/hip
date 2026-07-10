// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { useTerminalStore } from '@/store/terminalStore'

const pickDirectory = vi.fn()
const setProjectDir = vi.fn()
const ptyOpen = vi.fn()
const ptyWrite = vi.fn()
const ptyResize = vi.fn()
const ptyKill = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('lucide-react', () => ({
  Folder: () => React.createElement('span', { 'data-testid': 'icon-folder' }),
  RotateCcw: () => React.createElement('span', { 'data-testid': 'icon-restart' }),
}))

vi.mock('@/ipc/dialog', () => ({
  pickDirectory: (...args: unknown[]) => pickDirectory(...args),
}))

vi.mock('@/ipc/pty', () => ({
  ptyOpen: (...a: unknown[]) => ptyOpen(...a),
  ptyWrite: (...a: unknown[]) => ptyWrite(...a),
  ptyResize: (...a: unknown[]) => ptyResize(...a),
  ptyKill: (...a: unknown[]) => ptyKill(...a),
}))

vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockSessionId,
  useActiveSession: () => mockSession,
  sessionService: {
    setProjectDir: (...args: unknown[]) => setProjectDir(...args),
  },
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (sel: (s: { theme: string }) => unknown) => sel({ theme: 'system' }),
}))

// Minimal xterm stub — enough for mount/dispose without canvas.
vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    open = vi.fn()
    write = vi.fn()
    reset = vi.fn()
    dispose = vi.fn()
    loadAddon = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  },
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

import { TerminalView } from './TerminalView'

let mockSessionId: string | null = 's1'
let mockSession: { config: { cwd?: string } } | null = { config: {} }

describe('TerminalView', () => {
  beforeEach(() => {
    cleanup()
    mockSessionId = 's1'
    mockSession = { config: {} }
    pickDirectory.mockReset()
    setProjectDir.mockReset()
    ptyOpen.mockReset().mockResolvedValue({ reused: false })
    ptyWrite.mockReset().mockResolvedValue(undefined)
    ptyResize.mockReset().mockResolvedValue(undefined)
    ptyKill.mockReset().mockResolvedValue(undefined)
    useTerminalStore.setState({ bySession: {}, attachedSessionId: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows empty state when session has no cwd', () => {
    render(<TerminalView />)
    expect(screen.getByTestId('terminal-view-empty')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-select-folder')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-xterm')).toBeNull()
  })

  it('picks a folder and binds via setProjectDir', async () => {
    pickDirectory.mockResolvedValue('/tmp/proj')
    render(<TerminalView />)
    fireEvent.click(screen.getByTestId('terminal-select-folder'))
    await waitFor(() => {
      expect(pickDirectory).toHaveBeenCalled()
      expect(setProjectDir).toHaveBeenCalledWith('s1', '/tmp/proj')
    })
  })

  it('does not setProjectDir when picker is cancelled', async () => {
    pickDirectory.mockResolvedValue(null)
    render(<TerminalView />)
    fireEvent.click(screen.getByTestId('terminal-select-folder'))
    await waitFor(() => {
      expect(pickDirectory).toHaveBeenCalled()
    })
    expect(setProjectDir).not.toHaveBeenCalled()
  })

  it('mounts xterm host and calls ptyOpen when cwd is bound', async () => {
    mockSession = { config: { cwd: '/Users/me/hip' } }
    render(<TerminalView />)
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-xterm')).toBeInTheDocument()
    await waitFor(() => {
      expect(ptyOpen).toHaveBeenCalledWith('s1', '/Users/me/hip', expect.any(Number), expect.any(Number))
    })
  })

  it('restart kills PTY, clears ring, and re-opens', async () => {
    mockSession = { config: { cwd: '/Users/me/hip' } }
    useTerminalStore.getState().appendRing('s1', 'old')
    render(<TerminalView />)
    await waitFor(() => expect(ptyOpen).toHaveBeenCalled())
    ptyOpen.mockClear()
    fireEvent.click(screen.getByTestId('terminal-restart'))
    await waitFor(() => {
      expect(ptyKill).toHaveBeenCalledWith('s1')
      // clearSession then boot ensureSession — ring must not keep 'old'
      const ring = useTerminalStore.getState().bySession.s1?.ring ?? []
      expect(ring).not.toContain('old')
      expect(ptyOpen).toHaveBeenCalled()
    })
  })
})
