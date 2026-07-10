// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TerminalView } from './TerminalView'

const pickDirectory = vi.fn()
const setProjectDir = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('lucide-react', () => ({
  Folder: () => React.createElement('span', { 'data-testid': 'icon-folder' }),
}))

vi.mock('@/ipc/dialog', () => ({
  pickDirectory: (...args: unknown[]) => pickDirectory(...args),
}))

vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockSessionId,
  useActiveSession: () => mockSession,
  sessionService: {
    setProjectDir: (...args: unknown[]) => setProjectDir(...args),
  },
}))

let mockSessionId: string | null = 's1'
let mockSession: { config: { cwd?: string } } | null = { config: {} }

describe('TerminalView', () => {
  beforeEach(() => {
    cleanup()
    mockSessionId = 's1'
    mockSession = { config: {} }
    pickDirectory.mockReset()
    setProjectDir.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows empty state when session has no cwd', () => {
    render(<TerminalView />)
    expect(screen.getByTestId('terminal-view-empty')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-select-folder')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view-placeholder')).toBeNull()
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

  it('shows placeholder when cwd is bound (PR-1: no PTY yet)', () => {
    mockSession = { config: { cwd: '/Users/me/hip' } }
    render(<TerminalView />)
    expect(screen.getByTestId('terminal-view-placeholder')).toBeInTheDocument()
    expect(screen.getByText('/Users/me/hip')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view-empty')).toBeNull()
  })
})
