// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, createEvent, cleanup, waitFor } from '@testing-library/react'
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
  Loader2: () => React.createElement('span', { 'data-testid': 'icon-loader' }),
  AlertCircle: () => React.createElement('span', { 'data-testid': 'icon-alert' }),
}))

// Pass-through host so surface tests do not pull full context-menu + lucide icon map.
vi.mock('@/components/context-menu', () => ({
  CONTEXT_MENUS: true,
  DeclarativeContextMenu: ({
    children,
    className,
    'data-testid': testId,
  }: {
    children: React.ReactNode
    className?: string
    'data-testid'?: string
  }) => React.createElement('div', { className, 'data-testid': testId }, children),
  ControlledContextMenu: ({
    open,
    point,
  }: {
    open: boolean
    point: { x: number; y: number } | null
  }) =>
    open
      ? React.createElement('div', {
          'data-testid': 'controlled-context-menu-stub',
          'data-x': point?.x,
          'data-y': point?.y,
        })
      : null,
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
// Lazy import() resolves the same mocked modules.
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
    focus = vi.fn()
    getSelection = vi.fn(() => '')
    hasSelection = vi.fn(() => false)
    paste = vi.fn()
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

vi.mock('./terminalTheme', () => ({
  isDarkDom: () => false,
  buildXtermTheme: () => ({ background: '#fff', foreground: '#111', cursor: '#111' }),
}))

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
    ptyOpen.mockReset().mockResolvedValue({ reused: false, generation: 1 })
    ptyWrite.mockReset().mockResolvedValue(undefined)
    ptyResize.mockReset().mockResolvedValue(undefined)
    ptyKill.mockReset().mockResolvedValue(undefined)
    useTerminalStore.setState({ bySession: {}, attachedSessionId: null, attachedTerminalId: null })
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
    expect(screen.getByTestId('terminal-cwd')).toHaveTextContent('/Users/me/hip')
    await waitFor(() => {
      expect(ptyOpen).toHaveBeenCalledWith('s1', '/Users/me/hip', expect.any(Number), expect.any(Number))
    })
  })

  it('shows error status bar when ptyOpen fails', async () => {
    mockSession = { config: { cwd: '/Users/me/hip' } }
    ptyOpen.mockRejectedValueOnce(new Error('spawn shell failed: access denied'))
    render(<TerminalView />)
    await waitFor(() => {
      expect(screen.getByTestId('terminal-status-bar')).toBeInTheDocument()
      expect(screen.getByText('artifact.terminalView.error')).toBeInTheDocument()
    })
  })

  it('maps missing-shell errors to noShell label', async () => {
    mockSession = { config: { cwd: '/Users/me/hip' } }
    ptyOpen.mockRejectedValueOnce(new Error('pwsh.exe not found (install PowerShell 7+)'))
    render(<TerminalView />)
    await waitFor(() => {
      expect(screen.getByTestId('terminal-status-bar')).toBeInTheDocument()
      expect(screen.getByText('artifact.terminalView.noShell')).toBeInTheDocument()
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

  it('right-click on xterm canvas opens controlled menu at pointer', async () => {
    mockSession = { config: { cwd: '/Users/me/hip' } }
    render(<TerminalView />)
    await waitFor(() => expect(ptyOpen).toHaveBeenCalled())
    const host = screen.getByTestId('terminal-xterm')
    const ev = createEvent.contextMenu(host, { clientX: 42, clientY: 77 })
    fireEvent(host, ev)
    expect(ev.defaultPrevented).toBe(true)
    const menu = await screen.findByTestId('controlled-context-menu-stub')
    expect(menu).toHaveAttribute('data-x', '42')
    expect(menu).toHaveAttribute('data-y', '77')
  })

  it('unmount keep-alive: does not ptyKill and retains ring', async () => {
    mockSession = { config: { cwd: '/Users/me/hip' } }
    render(<TerminalView />)
    await waitFor(() => expect(ptyOpen).toHaveBeenCalled())
    useTerminalStore.getState().appendRing('s1', 'kept')
    cleanup()
    expect(ptyKill).not.toHaveBeenCalled()
    expect(useTerminalStore.getState().bySession.s1?.ring).toContain('kept')
    expect(useTerminalStore.getState().attachedTerminalId).toBeNull()
    expect(useTerminalStore.getState().attachedSessionId).toBeNull()
  })

  it('unmount exclusive detach: does not clear attach held by another id', async () => {
    mockSession = { config: { cwd: '/Users/me/hip' } }
    render(<TerminalView />)
    await waitFor(() => expect(ptyOpen).toHaveBeenCalled())
    // Simulate another surface already owning attach (focus steal).
    useTerminalStore.getState().setAttached('s2')
    cleanup()
    expect(ptyKill).not.toHaveBeenCalled()
    expect(useTerminalStore.getState().attachedTerminalId).toBe('s2')
    expect(useTerminalStore.getState().attachedSessionId).toBe('s2')
  })
})
