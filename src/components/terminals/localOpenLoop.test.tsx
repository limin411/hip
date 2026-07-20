// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, screen } from '@testing-library/react'
import React from 'react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/ipc/pty', () => ({
  ptyOpen: vi.fn().mockResolvedValue({ reused: false, generation: 1 }),
  ptyWrite: vi.fn().mockResolvedValue(undefined),
  ptyResize: vi.fn().mockResolvedValue(undefined),
  ptyKill: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/ipc/ssh', () => ({
  sshOpen: vi.fn(),
  sshWrite: vi.fn(),
  sshResize: vi.fn(),
  sshClose: vi.fn(),
  parseSshInvokeError: () => ({}),
}))

vi.mock('@/ipc/termFs', () => ({
  termFsLs: vi.fn().mockResolvedValue({
    path: '/Users/test',
    entries: [{ name: 'a', path: '/Users/test/a', isDir: false }],
  }),
  isTermFsNotReadyError: () => false,
  isTermFsEscapeError: () => false,
}))

vi.mock('@/ipc/sftp', () => ({
  listenSftpProgress: vi.fn().mockResolvedValue(() => {}),
  sftpCancel: vi.fn(),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    open() {}
    loadAddon() {}
    write() {}
    reset() {}
    focus() {}
    dispose() {}
    onData() {
      return { dispose() {} }
    }
    getSelection() {
      return ''
    }
    hasSelection() {
      return false
    }
    paste() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('@/components/context-menu', () => ({
  CONTEXT_MENUS: false,
  DeclarativeContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ControlledContextMenu: () => null,
}))

import { ManagedTerminalSession } from './ManagedTerminalSession'
import { TerminalFilesPanel } from './TerminalFilesPanel'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { useTerminalStore } from '@/store/terminalStore'

/**
 * Regression: TerminalFilesPanel must not select with inline `.filter()` —
 * a fresh array every snapshot causes useSyncExternalStore max update depth
 * when opening a local managed terminal (files panel mounts immediately).
 */
describe('local terminal open (no update-depth loop)', () => {
  beforeEach(() => {
    useManagedTerminalStore.setState({
      terminals: [
        {
          id: 'tm_loop1',
          kind: 'local',
          title: 'home',
          cwd: '/Users/test',
          createdAt: 1,
        },
      ],
      focusedId: 'tm_loop1',
    })
    useTerminalFsStore.setState({ byTerminal: {}, transfers: [] })
    useTerminalStore.setState({ bySession: {}, attachedSessionId: null, attachedTerminalId: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('TerminalFilesPanel mounts without maximum update depth', async () => {
    await act(async () => {
      render(<TerminalFilesPanel terminalId="tm_loop1" backend="local" localRoot="/Users/test" />)
    })
    expect(screen.getByTestId('managed-terminal-files')).toBeInTheDocument()
  })

  it('ManagedTerminalSession mounts local session without maximum update depth', async () => {
    await act(async () => {
      render(<ManagedTerminalSession terminalId="tm_loop1" />)
    })
    expect(screen.getByTestId('managed-terminal-session')).toBeInTheDocument()
    // Files panel is shell-owned (AppLayout right rail), not embedded here.
    expect(screen.queryByTestId('managed-terminal-files')).not.toBeInTheDocument()
  })
})
