// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/ipc/pty', () => ({
  ptyOpen: vi.fn().mockResolvedValue({ reused: false, generation: 1 }),
  ptyWrite: vi.fn(),
  ptyResize: vi.fn(),
  ptyKill: vi.fn(),
}))

vi.mock('@/ipc/ssh', () => ({
  sshOpen: vi.fn(),
  sshWrite: vi.fn(),
  sshResize: vi.fn(),
  sshClose: vi.fn(),
  parseSshInvokeError: () => ({}),
}))

vi.mock('@/components/artifact/XtermSurface', () => ({
  XtermSurface: () => <div data-testid="xterm-surface-stub" />,
}))

vi.mock('@/components/terminals/TerminalFilesPanel', () => ({
  TerminalFilesPanel: (props: {
    terminalId: string
    backend?: string
    localRoot?: string
    remotePath?: string
  }) => (
    <div
      data-testid="managed-terminal-files"
      data-backend={props.backend}
      data-local-root={props.localRoot}
      data-remote-path={props.remotePath}
    />
  ),
}))

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: ({ children }: { children: unknown }) => children,
}))

import { ManagedTerminalSession } from './ManagedTerminalSession'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'

describe('ManagedTerminalSession local files panel', () => {
  beforeEach(() => {
    useManagedTerminalStore.setState({
      terminals: [
        {
          id: 'tm_local1',
          kind: 'local',
          title: 'proj',
          cwd: '/tmp/proj',
          createdAt: 1,
        },
        {
          id: 'tm_ssh1',
          kind: 'ssh',
          title: 'ops',
          hostId: 'hst_1',
          remotePath: '/var/www',
          createdAt: 2,
        },
      ],
      focusedId: 'tm_local1',
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders local files panel with launch cwd for local terminals', () => {
    render(<ManagedTerminalSession terminalId="tm_local1" />)
    const panel = screen.getByTestId('managed-terminal-files')
    expect(panel).toHaveAttribute('data-backend', 'local')
    expect(panel).toHaveAttribute('data-local-root', '/tmp/proj')
  })

  it('renders sftp files panel for ssh terminals', () => {
    render(<ManagedTerminalSession terminalId="tm_ssh1" />)
    const panel = screen.getByTestId('managed-terminal-files')
    expect(panel).toHaveAttribute('data-backend', 'sftp')
    expect(panel).toHaveAttribute('data-remote-path', '/var/www')
  })
})
