// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const loadSftpDir = vi.fn().mockResolvedValue(undefined)
vi.mock('@/components/terminals/sftpActions', () => ({
  loadSftpDir: (...args: unknown[]) => loadSftpDir(...args),
  refreshSftpDir: vi.fn(),
  runSftpUploadIntoDir: vi.fn(),
}))

vi.mock('@/components/terminals/termFsActions', () => ({
  loadLocalDir: vi.fn(),
  refreshLocalDir: vi.fn(),
}))

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: ({ children }: { children: unknown }) => children,
}))

import { TerminalFileTree } from './TerminalFileTree'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { useTerminalStore } from '@/store/terminalStore'

describe('TerminalFileTree SFTP open gate', () => {
  beforeEach(() => {
    loadSftpDir.mockClear()
    useTerminalFsStore.setState({ byTerminal: {}, transfers: [] })
    useTerminalStore.setState({ bySession: {}, attachedSessionId: null, attachedTerminalId: null })
  })
  afterEach(() => cleanup())

  it('does not list until SSH status is running; shows loading while starting', () => {
    useTerminalStore.getState().ensureSession('tm_ssh')
    useTerminalStore.getState().setStatus('tm_ssh', 'starting')

    render(<TerminalFileTree terminalId="tm_ssh" backend="sftp" initialPath="/var/www" />)

    expect(loadSftpDir).not.toHaveBeenCalled()
    expect(screen.getByTestId('sftp-tree-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('sftp-session-closed')).not.toBeInTheDocument()
  })

  it('loads once status becomes running', async () => {
    useTerminalStore.getState().ensureSession('tm_ssh')
    useTerminalStore.getState().setStatus('tm_ssh', 'starting')

    render(<TerminalFileTree terminalId="tm_ssh" backend="sftp" initialPath="/var/www" />)
    expect(loadSftpDir).not.toHaveBeenCalled()

    await act(async () => {
      useTerminalStore.getState().setStatus('tm_ssh', 'running')
    })

    expect(loadSftpDir).toHaveBeenCalledWith('tm_ssh', '/var/www')
  })

  it('does not show permanent session_closed while still connecting', () => {
    useTerminalStore.getState().ensureSession('tm_ssh')
    useTerminalStore.getState().setStatus('tm_ssh', 'starting')
    useTerminalFsStore.getState().setError('tm_ssh', 'session_closed')

    render(<TerminalFileTree terminalId="tm_ssh" backend="sftp" />)

    expect(screen.queryByTestId('sftp-session-closed')).not.toBeInTheDocument()
    expect(screen.getByTestId('sftp-tree-loading')).toBeInTheDocument()
  })

  it('shows session_closed after connect finished when error remains', () => {
    useTerminalStore.getState().ensureSession('tm_ssh')
    useTerminalStore.getState().setStatus('tm_ssh', 'exited')
    useTerminalFsStore.getState().setError('tm_ssh', 'session_closed')

    render(<TerminalFileTree terminalId="tm_ssh" backend="sftp" />)

    expect(screen.getByTestId('sftp-session-closed')).toBeInTheDocument()
  })
})
