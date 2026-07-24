// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/ipc/sftp', () => ({
  listenSftpProgress: vi.fn().mockResolvedValue(() => {}),
  sftpCancel: vi.fn(),
}))

vi.mock('./TerminalFileTree', () => ({
  TerminalFileTree: () => <div data-testid="term-fs-file-tree-stub" />,
}))

vi.mock('@/components/layout/PanelToggle', async () => {
  const { useUiStore } = await import('@/store/uiStore')
  return {
    PanelToggle: () => (
      <button
        type="button"
        data-testid="terminal-files-panel-close"
        onClick={() => useUiStore.getState().setTerminalPanelOpen(false)}
      >
        collapse
      </button>
    ),
  }
})

import { TerminalFilesPanel } from './TerminalFilesPanel'
import { useUiStore } from '@/store/uiStore'
import { useTerminalFsStore } from '@/store/terminalFsStore'

describe('TerminalFilesPanel chrome', () => {
  beforeEach(() => {
    useUiStore.setState({ activeView: 'terminals', terminalPanelOpen: true })
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
