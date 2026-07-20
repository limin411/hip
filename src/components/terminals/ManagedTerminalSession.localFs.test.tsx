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

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: ({ children }: { children: unknown }) => children,
}))

import { ManagedTerminalSession } from './ManagedTerminalSession'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'

describe('ManagedTerminalSession layout', () => {
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

  it('does not embed files panel — shell right rail owns files (PanelToggle)', () => {
    render(<ManagedTerminalSession terminalId="tm_local1" />)
    expect(screen.getByTestId('managed-terminal-session')).toBeInTheDocument()
    expect(screen.getByTestId('xterm-surface-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('managed-terminal-files')).not.toBeInTheDocument()
  })

  it('ssh session also leaves files to the shell drawer', () => {
    render(<ManagedTerminalSession terminalId="tm_ssh1" />)
    expect(screen.getByTestId('managed-terminal-session')).toBeInTheDocument()
    expect(screen.queryByTestId('managed-terminal-files')).not.toBeInTheDocument()
  })
})
