// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { useWorktreeStore } from '@/store/worktreeStore'
import { useParallelStore } from '@/store/parallelStore'
import { BranchSwitcher } from './BranchSwitcher'

// BranchSwitcher → sessionService → @/i18n bootstrap fails in happy-dom; the component
// only touches requestBranches/switchBranch, both stubbed here.
vi.mock('@/domain/sessionService', () => ({
  sessionService: {
    requestBranches: vi.fn(),
    switchBranch: vi.fn(),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'artifact.branch.current': 'Current branch',
        'artifact.branch.noBranch': '(no branch)',
        'artifact.branch.switchTitle': 'Switch branch',
        'artifact.branch.searchPlaceholder': 'Search branches…',
        'artifact.branch.empty': 'No branches found',
        'artifact.branch.noMatch': 'No matching branches',
        'artifact.branch.switchConfirmTitle': 'Switch to branch "{{branch}}"?',
        'artifact.branch.switchConfirmBody': 'Switches the git checkout.',
        'artifact.branch.switchConfirmAction': 'Switch',
        'artifact.branch.switching': 'Switching…',
        'artifact.branch.switchFailed': 'Could not switch branch',
        'artifact.branch.switchRetry': 'Retry',
        'artifact.branch.inWorktree': 'worktree',
        'artifact.branch.switchBlockedRunning':
          'Cannot switch branches while a session is running in this workspace',
        'artifact.branch.switchCheckedOut':
          'This branch is already checked out in another workspace: {{path}}',
        'common.cancel': 'Cancel',
      }
      const val = map[key] ?? key
      if (vars) return val.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))
      return val
    },
  }),
}))

// Radix portals don't interact well with happy-dom clicks — render inline like the
// other dropdown tests in this repo (PanelTabBar / PermissionModePicker).
vi.mock('@/components/ui/DropdownMenu', async () => {
  const R = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      R.createElement(R.Fragment, null, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
      R.createElement(R.Fragment, null, children),
    DropdownMenuContent: ({
      children,
      ...rest
    }: {
      children: React.ReactNode
      'data-testid'?: string
    }) => R.createElement('div', { 'data-testid': rest['data-testid'] }, children),
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) =>
      R.createElement('div', null, children),
    DropdownMenuItem: ({
      children,
      onSelect,
      ...rest
    }: {
      children: React.ReactNode
      onSelect?: () => void
      'data-testid'?: string
    }) =>
      R.createElement(
        'div',
        { 'data-testid': rest['data-testid'], onClick: () => onSelect?.() },
        children,
      ),
  }
})

vi.mock('@/components/ui/Modal', async () => {
  const R = await import('react')
  return {
    Modal: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
      open ? R.createElement('div', { 'data-testid': 'modal' }, children) : null,
  }
})

function seedSession(over: Record<string, unknown> = {}) {
  useDomainStore.setState({
    sessions: [
      {
        id: 's1',
        title: 'T',
        preview: '',
        updatedAtMs: 0,
        loaded: true,
        messages: [],
        status: 'idle',
        config: { surface: 'code', cwd: '/main' },
        ...over,
      },
    ],
    activeSessionId: 's1',
  } as never)
}

function seedDiff(over: Record<string, unknown> = {}) {
  useDiffStore.setState({
    bySession: {
      s1: {
        currentBranch: 'main',
        branches: [
          { name: 'main', current: true },
          { name: 'feature-x', current: false },
        ],
        ...over,
      },
    },
  } as never)
}

function openConfirmFor(branch: string) {
  fireEvent.click(screen.getByText(branch))
}

describe('BranchSwitcher', () => {
  beforeEach(() => {
    useDomainStore.setState({ sessions: [], activeSessionId: null } as never)
    useDiffStore.setState({ bySession: {} } as never)
    useWorktreeStore.setState({ byId: {} } as never)
    useParallelStore.setState({ runs: [] } as never)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders null without an active session', () => {
    render(<BranchSwitcher />)
    expect(screen.queryByTestId('branch-chip')).not.toBeInTheDocument()
  })

  it('shows the current branch on the chip', () => {
    seedSession()
    seedDiff({ currentBranch: 'feature-x' })
    render(<BranchSwitcher />)
    expect(screen.getByTestId('branch-chip')).toHaveTextContent('feature-x')
  })

  // C3: isolated worktree → the chip labels the scope so branch ops are unambiguous.
  it('appends a worktree suffix when the session is inside an isolated worktree', () => {
    seedSession({ config: { surface: 'code', cwd: '/wt' } })
    seedDiff({ currentBranch: 'feature-x' })
    useWorktreeStore.setState({
      byId: {
        wt1: {
          id: 'wt1',
          path: '/wt',
          branch: 'feature-x',
          head: 'abc123',
          repoKey: 'r',
          isPrimary: false,
          managed: true,
          hostSessionId: 'host',
        },
      },
    } as never)
    render(<BranchSwitcher />)
    expect(screen.getByTestId('branch-chip')).toHaveTextContent('feature-x · worktree')
  })

  it('keeps the plain label on the primary checkout', () => {
    seedSession({ config: { surface: 'code', cwd: '/main' } })
    seedDiff({ currentBranch: 'main' })
    render(<BranchSwitcher />)
    expect(screen.getByTestId('branch-chip')).toHaveTextContent('main')
    expect(screen.getByTestId('branch-chip')).not.toHaveTextContent('worktree')
  })

  // C1: switching would rewrite files under a running agent in the same checkout.
  it('blocks the switch confirm while a session is running in the same checkout', () => {
    seedSession({ status: 'running', config: { surface: 'code', cwd: '/main' } })
    seedDiff()
    render(<BranchSwitcher />)
    openConfirmFor('feature-x')
    expect(screen.getByTestId('branch-switch-running-warning')).toBeInTheDocument()
    expect(screen.getByTestId('branch-switch-confirm')).toBeDisabled()
  })

  it('allows the switch when no session is running in the checkout', () => {
    seedSession({ status: 'idle', config: { surface: 'code', cwd: '/main' } })
    seedDiff()
    render(<BranchSwitcher />)
    openConfirmFor('feature-x')
    expect(screen.queryByTestId('branch-switch-running-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('branch-switch-confirm')).toBeEnabled()
  })

  it('does not block on a running session in a different checkout', () => {
    seedSession({ status: 'idle', config: { surface: 'code', cwd: '/main' } })
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 'T',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'idle',
          config: { surface: 'code', cwd: '/main' },
        },
        {
          id: 's2',
          title: 'WT',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'running',
          config: { surface: 'code', cwd: '/other-checkout' },
        },
      ],
      activeSessionId: 's1',
    } as never)
    seedDiff()
    render(<BranchSwitcher />)
    openConfirmFor('feature-x')
    expect(screen.queryByTestId('branch-switch-running-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('branch-switch-confirm')).toBeEnabled()
  })

  // C2: git's "already checked out" failure → point at the owning workspace.
  it('shows a friendly already-checked-out message with the owning workspace path', () => {
    seedSession()
    seedDiff({
      switchError: "fatal: 'feature-x' is already checked out at '/other/wt'",
    })
    render(<BranchSwitcher />)
    openConfirmFor('feature-x')
    expect(screen.getByTestId('branch-switch-error')).toHaveTextContent(
      'This branch is already checked out in another workspace: /other/wt',
    )
  })

  it('falls back to the raw error for unrelated git failures', () => {
    seedSession()
    seedDiff({ switchError: 'fatal: invalid branch name' })
    render(<BranchSwitcher />)
    openConfirmFor('feature-x')
    expect(screen.getByTestId('branch-switch-error')).toHaveTextContent(
      'Could not switch branch: fatal: invalid branch name',
    )
  })
})
