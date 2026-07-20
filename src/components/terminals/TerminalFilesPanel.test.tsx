// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/ipc/sftp', () => ({
  listenSftpProgress: vi.fn().mockResolvedValue(() => {}),
  sftpCancel: vi.fn(),
}))

vi.mock('./TerminalFileTree', () => ({
  TerminalFileTree: () => <div data-testid="term-fs-file-tree-stub" />,
}))

import { TerminalFilesPanel } from './TerminalFilesPanel'
import { useUiStore } from '@/store/uiStore'
import { useTerminalFsStore } from '@/store/terminalFsStore'

describe('TerminalFilesPanel chrome', () => {
  beforeEach(() => {
    useUiStore.setState({ terminalPanelOpen: true })
    useTerminalFsStore.setState({ byTerminal: {}, transfers: [] })
  })
  afterEach(() => cleanup())

  it('matches shell right-rail chrome: titlebar height, close button, surface bg', () => {
    render(
      <TerminalFilesPanel terminalId="tm_1" backend="local" localRoot="/tmp" />,
    )
    const root = screen.getByTestId('managed-terminal-files')
    expect(root).toHaveClass('bg-surface')
    expect(root).toHaveClass('border-l')
    expect(screen.getByTestId('panel-title')).toBeInTheDocument()
    const close = screen.getByTestId('terminal-files-panel-close')
    expect(close).toBeInTheDocument()
    fireEvent.click(close)
    expect(useUiStore.getState().terminalPanelOpen).toBe(false)
  })
})
