// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { DiffFile } from '@hip/protocol'
import { ChangesView } from './ChangesView'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useUiStore } from '@/store/uiStore'
import { sessionService } from '@/domain/sessionService'
import '@/i18n'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  }
})

vi.mock('@/domain/sessionService', () => ({
  sessionService: {
    requestDiff: vi.fn(),
    requestCommitLog: vi.fn(),
    requestCommitDiff: vi.fn(),
    requestDiffFile: vi.fn(),
    discardFile: vi.fn(),
    gitInitWorkspace: vi.fn(),
  },
}))

vi.mock('@/components/command-palette/composerBridge', () => ({
  insertComposerText: vi.fn(() => true),
}))

vi.mock('@/components/ui/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="changes-toolbar-menu-content">{children}</div>
  ),
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick} data-testid="changes-menu-item">{children}</button>
  ),
  DropdownMenuRadioGroup: ({ children }: { children: ReactNode }) => (
    <div role="radiogroup">{children}</div>
  ),
  DropdownMenuRadioItem: ({
    children,
    onValueChange,
    value,
  }: {
    children: ReactNode
    onValueChange?: (v: string) => void
    value: string
  }) => (
    <button type="button" role="radio" data-value={value} onClick={() => onValueChange?.(value)}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}))

const file: DiffFile = {
  path: 'src/a.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  hunks: [],
}

function seedSession() {
  useDomainStore.setState({
    sessions: [{
      id: 's1',
      config: { llmProvider: 'deepseek', model: 'm', tools: [], surface: 'code', cwd: '/proj' },
      title: '',
      preview: '',
      updatedAtMs: 0,
      loaded: true,
      messages: [],
      status: 'idle',
      error: null,
      codePanelOpen: true,
      chatPanelOpen: false,
    }],
    activeSessionId: 's1',
  })
}

class ROStub {
  constructor(_cb: ResizeObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  seedSession()
  useDiffStore.setState({ bySession: {} })
  useUiStore.setState({
    activeTab: 'changes',
    diffViewMode: 'unified',
    ignoreWhitespace: false,
    changesCommitExpanded: false,
    changesCommitHeight: 168,
  })
  vi.stubGlobal('ResizeObserver', ROStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('ChangesView v2', () => {
  it('disables the session-start baseline without a checkpoint and keeps HEAD enabled', () => {
    useDiffStore.setState({
      bySession: {
        s1: { ...EMPTY_DIFF, status: 'ready', state: 'ok', hasSessionStart: false, files: [file], commitLog: { status: 'ready', state: 'ok', commits: [] } },
      },
    })
    render(<ChangesView />)
    const sessionBase = screen.getByTestId('changes-base-session-start')
    const headBase = screen.getByTestId('changes-base-head')
    expect(sessionBase).toBeDisabled()
    expect(headBase).toBeEnabled()
  })

  it('collapses the commit section to 36px when uncommitted changes exist', () => {
    useDiffStore.setState({
      bySession: {
        s1: {
          ...EMPTY_DIFF,
          status: 'ready',
          state: 'ok',
          hasSessionStart: true,
          files: [file],
          commitLog: {
            status: 'ready',
            state: 'ok',
            commits: [{ sha: 'abc1234', shortSha: 'abc1234', message: 'm', author: 'me', timestamp: 0 }],
          },
        },
      },
    })
    render(<ChangesView />)
    const section = screen.getByTestId('changes-commit-section')
    expect(section).toHaveStyle({ height: '36px' })
    expect(screen.queryByTestId('commit-row-button')).toBeNull()
  })

  it('commit click loads the commit diff and the back bar returns to uncommitted', async () => {
    useDiffStore.setState({
      bySession: {
        s1: {
          ...EMPTY_DIFF,
          status: 'ready',
          state: 'ok',
          hasSessionStart: true,
          files: [file],
          commitLog: {
            status: 'ready',
            state: 'ok',
            commits: [{ sha: 'abc1234', shortSha: 'abc1234', message: 'm', author: 'me', timestamp: 0 }],
          },
        },
      },
    })
    render(<ChangesView />)
    fireEvent.click(screen.getByTestId('changes-commit-title'))
    fireEvent.click(await screen.findByTestId('commit-row-button'))
    expect(sessionService.requestCommitDiff).toHaveBeenCalledWith('s1', 'abc1234')

    // Simulate the sidecar round-trip the mocked service would otherwise drive.
    useDiffStore.getState().setViewingCommit('s1', 'abc1234')
    useDiffStore.getState().setCommitDiffResult('s1', { state: 'ok', files: [file] })
    const back = await screen.findByTestId('changes-back-uncommitted')
    expect(back).toBeInTheDocument()
    fireEvent.click(back)
    await waitFor(() => expect(useDiffStore.getState().bySession['s1'].viewingCommitSha).toBeNull())
    await waitFor(() => expect(screen.queryByTestId('changes-back-uncommitted')).toBeNull())
  })

  it('ignore-whitespace toggle re-pulls the diff', () => {
    useDiffStore.setState({
      bySession: {
        s1: { ...EMPTY_DIFF, status: 'ready', state: 'ok', hasSessionStart: true, files: [file], commitLog: { status: 'ready', state: 'ok', commits: [] } },
      },
    })
    render(<ChangesView />)
    fireEvent.click(screen.getByText('artifact.changesView.ignoreWhitespace'))
    expect(useUiStore.getState().ignoreWhitespace).toBe(true)
    expect(sessionService.requestDiff).toHaveBeenLastCalledWith('s1', undefined, true)
  })
})
