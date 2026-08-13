// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createContext, useContext, type ReactNode } from 'react'
import type { DiffFile } from '@hip/protocol'
import { ChangesView } from './ChangesView'
import { ChangesTitlebarActions } from './ChangesTitlebarActions'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useUiStore } from '@/store/uiStore'
import { sessionService } from '@/domain/sessionService'
import { insertComposerText } from '@/components/command-palette/composerBridge'
import '@/i18n'

/** Body + titlebar chrome (actions live in PanelContextSlot in the real shell). */
function renderChanges() {
  return render(
    <>
      <ChangesTitlebarActions />
      <ChangesView />
    </>,
  )
}

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key === 'artifact.changesView.reviewPrompt') {
          return `REVIEW ${String(opts?.files ?? '')} @ ${String(opts?.base ?? '')}`
        }
        if (key === 'artifact.changesView.commitPrompt') {
          return 'COMMIT branch={{branch}} message={{message}} filesNote={{filesNote}} files={{files}}'
        }
        if (key === 'artifact.changesView.commitMessageByAgent') return '(msg-agent)'
        if (key === 'artifact.changesView.commitFilesByAgent') return '(files-agent)'
        if (key === 'artifact.changesView.commitBranchUnknown') return '(unknown-branch)'
        if (key === 'artifact.changesView.commitFilesHint') return `hint:${opts?.count}`
        if (key === 'artifact.changesView.pushPrompt') {
          return `PUSH branch=${String(opts?.branch ?? '')}`
        }
        return key
      },
      i18n: { language: 'en' },
    }),
  }
})

vi.mock('@/domain/sessionService', () => ({
  sessionService: {
    requestDiff: vi.fn(),
    requestDiffFile: vi.fn(),
    requestCheckpoints: vi.fn(),
    discardFile: vi.fn(),
    gitInitWorkspace: vi.fn(),
    sendMessage: vi.fn(),
  },
}))

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    open,
    title,
    children,
    footer,
  }: {
    open: boolean
    title: string
    children: ReactNode
    footer?: ReactNode
  }) =>
    open ? (
      <div data-testid="commit-modal">
        <h1>{title}</h1>
        {children}
        {footer}
      </div>
    ) : null,
}))

vi.mock('@/components/command-palette/composerBridge', () => ({
  insertComposerText: vi.fn(() => true),
}))

vi.mock('@/components/ui/DropdownMenu', () => {
  const RadioCtx = createContext<(v: string) => void>(() => {})
  return {
    DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children: ReactNode }) => (
      <div data-testid="changes-toolbar-menu-content">{children}</div>
    ),
    DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick} data-testid="changes-menu-item">{children}</button>
    ),
    DropdownMenuRadioGroup: ({
      children,
      onValueChange,
    }: {
      children: ReactNode
      onValueChange?: (v: string) => void
    }) => (
      <RadioCtx.Provider value={onValueChange ?? (() => {})}>
        <div role="radiogroup">{children}</div>
      </RadioCtx.Provider>
    ),
    DropdownMenuRadioItem: ({ children, value }: { children: ReactNode; value: string }) => {
      const onValueChange = useContext(RadioCtx)
      return (
        <button type="button" role="radio" data-value={value} onClick={() => onValueChange(value)}>
          {children}
        </button>
      )
    },
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }
})

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
    diffContext: 'full',
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
        s1: { ...EMPTY_DIFF, status: 'ready', state: 'ok', hasSessionStart: false, files: [file] },
      },
    })
    renderChanges()
    const sessionBase = screen.getByTestId('changes-base-session-start')
    const headBase = screen.getByTestId('changes-base-head')
    expect(sessionBase).toBeDisabled()
    expect(headBase).toBeEnabled()
  })

  it('does not render a recent-commits section', () => {
    useDiffStore.setState({
      bySession: {
        s1: {
          ...EMPTY_DIFF,
          status: 'ready',
          state: 'ok',
          hasSessionStart: true,
          files: [file],
        },
      },
    })
    renderChanges()
    expect(screen.queryByTestId('changes-commit-section')).toBeNull()
    expect(screen.queryByText('artifact.changesView.recentCommits')).toBeNull()
  })

  it('ignore-whitespace toggle re-pulls the diff', () => {
    useDiffStore.setState({
      bySession: {
        s1: { ...EMPTY_DIFF, status: 'ready', state: 'ok', hasSessionStart: true, files: [file] },
      },
    })
    renderChanges()
    fireEvent.click(screen.getByText('artifact.changesView.ignoreWhitespace'))
    expect(useUiStore.getState().ignoreWhitespace).toBe(true)
    expect(sessionService.requestDiff).toHaveBeenLastCalledWith('s1', undefined, true)
  })

  it('running session disables discard, review, commit, and push CTAs', () => {
    useDomainStore.setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) => (s.id === 's1' ? { ...s, status: 'running' } : s)),
    }))
    useDiffStore.setState({
      bySession: {
        s1: { ...EMPTY_DIFF, status: 'ready', state: 'ok', hasSessionStart: true, files: [file] },
      },
    })
    renderChanges()
    expect(screen.getByTestId('diff-discard')).toBeDisabled()
    expect(screen.getByTestId('changes-review')).toBeDisabled()
    expect(screen.getByTestId('changes-commit')).toBeDisabled()
    expect(screen.getByTestId('changes-push')).toBeDisabled()
  })

  it('push button sends a push prompt to the agent even when clean', () => {
    useDiffStore.setState({
      bySession: {
        s1: {
          ...EMPTY_DIFF,
          status: 'ready',
          state: 'ok',
          hasSessionStart: true,
          currentBranch: 'main',
          files: [],
        },
      },
    })
    renderChanges()
    expect(screen.getByTestId('changes-push')).toBeEnabled()
    fireEvent.click(screen.getByTestId('changes-push'))
    expect(sessionService.sendMessage).toHaveBeenCalledWith('PUSH branch=main')
  })

  it('commit button opens dialog and confirm sends the prompt to the agent', () => {
    useDiffStore.setState({
      bySession: {
        s1: {
          ...EMPTY_DIFF,
          status: 'ready',
          state: 'ok',
          hasSessionStart: true,
          currentBranch: 'main',
          files: [file],
        },
      },
    })
    renderChanges()
    fireEvent.click(screen.getByTestId('changes-commit'))
    expect(sessionService.requestCheckpoints).toHaveBeenCalledWith('s1')
    expect(screen.getByTestId('changes-commit-branch')).toHaveTextContent('main')
    fireEvent.change(screen.getByTestId('changes-commit-message'), {
      target: { value: 'feat: x' },
    })
    fireEvent.click(screen.getByTestId('changes-commit-confirm'))
    expect(sessionService.sendMessage).toHaveBeenCalledWith(expect.stringContaining('branch=main'))
    expect(sessionService.sendMessage).toHaveBeenCalledWith(expect.stringContaining('message=feat: x'))
    expect(sessionService.sendMessage).toHaveBeenCalledWith(expect.stringContaining('files=src/a.ts'))
    expect(insertComposerText).not.toHaveBeenCalled()
  })

  it('discard confirm sends git:discard through sessionService', async () => {
    useDiffStore.setState({
      bySession: {
        s1: { ...EMPTY_DIFF, status: 'ready', state: 'ok', hasSessionStart: true, files: [file] },
      },
    })
    renderChanges()
    fireEvent.click(screen.getByTestId('diff-discard'))
    fireEvent.click(await screen.findByTestId('diff-discard-confirm'))
    expect(sessionService.discardFile).toHaveBeenCalledWith('s1', 'src/a.ts', 'modified', undefined)
  })

  it('T8: ⌘F focuses the filter, typing filters files, Esc restores', () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      ...file,
      path: `src/mod${i % 2 === 0 ? 'a' : 'b'}/f${i}.ts`,
    }))
    useDiffStore.setState({
      bySession: {
        s1: {
          ...EMPTY_DIFF,
          status: 'ready',
          state: 'ok',
          hasSessionStart: true,
          files,
          summary: { totalFiles: 8, totalAdditions: 8, totalDeletions: 8 },
        },
      },
    })
    renderChanges()
    // >6 文件 → 汇总条显示
    const bar = screen.getByTestId('diff-summarybar')
    expect(bar).toBeInTheDocument()
    // ⌘F 聚焦筛选输入
    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(screen.getByTestId('diff-filter-input')).toHaveFocus()
    // 输入筛选 → 只留匹配文件
    fireEvent.change(screen.getByTestId('diff-filter-input'), { target: { value: 'moda' } })
    expect(screen.getAllByTestId('diff-file')).toHaveLength(4)
    // 无匹配 → 空态
    fireEvent.change(screen.getByTestId('diff-filter-input'), { target: { value: 'nope' } })
    expect(screen.getByTestId('diff-filter-empty')).toBeInTheDocument()
    // Esc 还原全部
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getAllByTestId('diff-file')).toHaveLength(8)
    expect(screen.queryByTestId('diff-filter-empty')).toBeNull()
  })

  it('review CTA injects a prompt with the file list into the composer', () => {
    useDiffStore.setState({
      bySession: {
        s1: { ...EMPTY_DIFF, status: 'ready', state: 'ok', hasSessionStart: true, files: [file] },
      },
    })
    renderChanges()
    fireEvent.click(screen.getByTestId('changes-review'))
    expect(insertComposerText).toHaveBeenCalledWith(expect.stringContaining('src/a.ts'))
  })

  // ---- PR-3: hunk 徽标 / 上下文档位 / 展开（T5/T6/T11） ----

  const hunkFile: DiffFile = {
    path: 'src/b.ts',
    status: 'modified',
    additions: 1,
    deletions: 2,
    hunks: [{
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 1,
      header: 'foo',
      lines: [
        { type: 'del', content: 'a', oldNo: 1, newNo: null },
        { type: 'del', content: 'b', oldNo: 2, newNo: null },
        { type: 'add', content: 'c', oldNo: null, newNo: 1 },
      ],
    }],
  }

  it('T5: hunk header shows +N −M badge derived from line counts', () => {
    useDiffStore.setState({
      bySession: {
        s1: { ...EMPTY_DIFF, status: 'ready', state: 'ok', hasSessionStart: true, files: [hunkFile] },
      },
    })
    renderChanges()
    const badge = screen.getByTestId('diff-hunk-badge')
    expect(badge).toHaveTextContent('+1')
    expect(badge).toHaveTextContent('−2')
  })

  it('T6: context tier switch collapses expanded files and re-fetches with the new tier', () => {
    useDiffStore.setState({
      bySession: {
        s1: {
          ...EMPTY_DIFF,
          status: 'ready',
          state: 'ok',
          hasSessionStart: true,
          files: [hunkFile],
          expanded: { 'src/b.ts': hunkFile },
        },
      },
    })
    renderChanges()
    // ⋯ 菜单「5 行」档位（DropdownMenu mock 的 radio 项带 data-value）
    const five = screen.getAllByRole('radio').find((r) => r.getAttribute('data-value') === '5')!
    fireEvent.click(five)
    expect(useUiStore.getState().diffContext).toBe(5)
    expect(useDiffStore.getState().bySession.s1.expanded['src/b.ts']).toBeUndefined()
    expect(sessionService.requestDiffFile).toHaveBeenCalledWith('s1', 'src/b.ts', 5)
  })

  it('T11: expand buttons re-fetch the file with stepped context; tier switch collapses+refetches', () => {
    useDiffStore.setState({
      bySession: {
        s1: {
          ...EMPTY_DIFF,
          status: 'ready',
          state: 'ok',
          hasSessionStart: true,
          files: [hunkFile],
          expanded: { 'src/b.ts': hunkFile },
        },
      },
    })
    renderChanges()
    // 挂载不触发档位 effect（prev 守卫），文件保持展开；初始 ctx = git 默认 3 → ↑ = 3+5
    expect(screen.getByTestId('diff-hunk-expand-up')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('diff-hunk-expand-up'))
    expect(sessionService.requestDiffFile).toHaveBeenCalledWith('s1', 'src/b.ts', 8)
    fireEvent.click(screen.getByTestId('diff-hunk-expand-down'))
    expect(sessionService.requestDiffFile).toHaveBeenLastCalledWith('s1', 'src/b.ts', 3)
    // 档位切到「2 行」→ 收起 + 以新档位重拉
    const two = screen.getAllByRole('radio').find((r) => r.getAttribute('data-value') === '2')!
    fireEvent.click(two)
    expect(sessionService.requestDiffFile).toHaveBeenLastCalledWith('s1', 'src/b.ts', 2)
    expect(useDiffStore.getState().bySession.s1.expanded['src/b.ts']).toBeUndefined()
  })
})
