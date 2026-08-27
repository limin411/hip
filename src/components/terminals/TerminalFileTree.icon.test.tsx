// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/terminals/sftpActions', () => ({
  loadSftpDir: vi.fn(),
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

describe('TerminalFileTree entry icons (project-parity type icons)', () => {
  beforeEach(() => {
    useTerminalFsStore.setState({ byTerminal: {}, transfers: [] })
    useTerminalStore.setState({ bySession: {}, attachedSessionId: null, attachedTerminalId: null })
    useTerminalStore.getState().ensureSession('tm_ssh')
    useTerminalStore.getState().setStatus('tm_ssh', 'running')
    useTerminalFsStore.getState().setRootPath('tm_ssh', '/var/www')
    useTerminalFsStore.getState().setEntries('tm_ssh', '/var/www', [
      { name: 'main.ts', path: '/var/www/main.ts', isDir: false },
      { name: 'logo.png', path: '/var/www/logo.png', isDir: false },
      { name: 'mystery.xyzzy', path: '/var/www/mystery.xyzzy', isDir: false },
      { name: 'src', path: '/var/www/src', isDir: true },
    ])
  })
  afterEach(() => cleanup())

  it('colors type icons per extension like the project FileTree', () => {
    render(<TerminalFileTree terminalId="tm_ssh" backend="sftp" initialPath="/var/www" />)

    const icons = screen.getAllByTestId('term-file-type-icon')
    const byName = Object.fromEntries(
      icons.map((i) => [i.getAttribute('data-file-name'), i]),
    )

    expect(byName['main.ts']?.getAttribute('class')).toContain('text-sky-600')
    expect(byName['main.ts']?.getAttribute('class')).toContain('dark:text-sky-400')
    expect(byName['logo.png']?.getAttribute('class')).toContain('text-fuchsia-600')
    // Unknown extension keeps the neutral default — no visual regression.
    expect(byName['mystery.xyzzy']?.getAttribute('class')).toContain('text-ink-tertiary')
  })

  it('renders amber folder icons (light + dark) matching FileTree', () => {
    render(<TerminalFileTree terminalId="tm_ssh" backend="sftp" initialPath="/var/www" />)

    const folderRow = screen
      .getAllByTestId('sftp-entry')
      .find((r) => r.getAttribute('data-dir') === '1')
    expect(folderRow).toBeTruthy()
    expect(folderRow?.innerHTML).toContain('text-amber-600/80')
    expect(folderRow?.innerHTML).toContain('dark:text-amber-400/90')
  })
})
