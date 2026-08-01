// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { useDomainStore, DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useWorktreeStore } from '@/store/worktreeStore'
import { useParallelStore } from '@/store/parallelStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import { WorktreeControl } from './WorktreeControl'

const createManagedWorktree = vi.fn()
const requestWorktreeList = vi.fn()

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: {
      ...actual.sessionService,
      createManagedWorktree: (...args: unknown[]) => createManagedWorktree(...args),
      requestWorktreeList: (...args: unknown[]) => requestWorktreeList(...args),
    },
  }
})

vi.mock('@/components/layout/sidebarActions', () => ({
  selectSessionFromSidebar: vi.fn(),
}))
import { selectSessionFromSidebar } from '@/components/layout/sidebarActions'

vi.mock('@/ipc/clipboard', () => ({
  copyText: vi.fn(async () => true),
}))

function seedHostSession() {
  useDomainStore.setState({
    sessions: [
      {
        id: 'host1',
        config: {
          ...DEFAULT_CONFIG,
          surface: 'code',
          cwd: '/repo',
          permissionMode: 'edit',
        },
        title: 'Host',
        preview: '',
        updatedAtMs: 1,
        loaded: true,
        messages: [],
        status: 'idle',
        error: null,
      },
    ],
    activeSessionId: 'host1',
    connection: 'disconnected',
  })
  useWorktreeStore.setState({
    byId: {
      primary: {
        id: 'primary',
        path: '/repo',
        branch: 'main',
        head: 'abc',
        repoKey: 'repo',
        isPrimary: true,
        managed: false,
        hostSessionId: 'host1',
      },
    },
  })
  useParallelStore.setState({ runs: [] })
  useProjectPathStore.getState().markOk('/repo')
}

describe('WorktreeControl non-git wiring (PR4 / D24)', () => {
  beforeEach(async () => {
    cleanup()
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await i18n.changeLanguage('en')
    seedHostSession()
    createManagedWorktree.mockResolvedValue({ ok: false, error: 'not_a_repo' })
    vi.spyOn(toast, 'error').mockImplementation(() => '')
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    vi.restoreAllMocks()
  })

  it('after non-git create error shows banner and disables create CTA', async () => {
    render(<WorktreeControl />)

    // Open browse popover
    fireEvent.click(screen.getByTestId('worktree-control-chip'))
    await waitFor(() => {
      expect(screen.getByTestId('worktree-control-create-single')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('worktree-control-non-git')).toBeNull()
    expect(screen.getByTestId('worktree-control-create-single')).not.toBeDisabled()
    expect(screen.queryByTestId('worktree-control-parallel')).toBeNull()

    // Open single create modal (popover closes first via setTimeout(0))
    fireEvent.click(screen.getByTestId('worktree-control-create-single'))
    await act(async () => {
      vi.runOnlyPendingTimers()
    })
    await waitFor(() => {
      expect(screen.getByTestId('worktree-create-single-confirm')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('worktree-create-single-confirm'))
    await waitFor(() => {
      expect(createManagedWorktree).toHaveBeenCalledTimes(1)
    })
    // Modal closed
    await waitFor(() => {
      expect(screen.queryByTestId('worktree-create-single-confirm')).toBeNull()
    })

    // Re-open popover — non-git banner + disabled create (D24)
    fireEvent.click(screen.getByTestId('worktree-control-chip'))
    await waitFor(() => {
      expect(screen.getByTestId('worktree-control-non-git')).toBeInTheDocument()
    })
    expect(screen.getByTestId('worktree-control-create-single')).toBeDisabled()
  })

  it('lists Main workspace as a row and switches back from an isolation', async () => {
    // Active session is on an isolated worktree; catalog holds primary + the isolation.
    useDomainStore.setState({
      sessions: [
        {
          id: 'iso1',
          config: {
            ...DEFAULT_CONFIG,
            surface: 'code',
            cwd: '/repo/.hip/worktrees/iso1',
            permissionMode: 'edit',
          },
          title: 'Iso',
          preview: '',
          updatedAtMs: 2,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
        },
        {
          id: 'host1',
          config: {
            ...DEFAULT_CONFIG,
            surface: 'code',
            cwd: '/repo',
            permissionMode: 'edit',
          },
          title: 'Host',
          preview: '',
          updatedAtMs: 1,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
        },
      ],
      activeSessionId: 'iso1',
      connection: 'disconnected',
    })
    useWorktreeStore.setState({
      byId: {
        primary: {
          id: 'primary',
          path: '/repo',
          branch: 'main',
          head: 'abc',
          repoKey: 'repo',
          isPrimary: true,
          managed: false,
          hostSessionId: 'host1',
        },
        iso1: {
          id: 'iso1',
          path: '/repo/.hip/worktrees/iso1',
          branch: 'hip-iso-abc123',
          head: 'abc',
          repoKey: 'repo',
          isPrimary: false,
          managed: true,
          hostSessionId: 'host1',
        },
      },
    })
    useParallelStore.setState({ runs: [] })
    useProjectPathStore.getState().markOk('/repo')
    useProjectPathStore.getState().markOk('/repo/.hip/worktrees/iso1')

    render(<WorktreeControl />)
    fireEvent.click(screen.getByTestId('worktree-control-chip'))
    await waitFor(() => {
      expect(screen.getByTestId('worktree-control-row-primary')).toBeInTheDocument()
    })
    expect(screen.getByText('Main workspace')).toBeInTheDocument()
    // Badge counts the isolation, not the main workspace.
    expect(screen.getByTestId('worktree-control-badge')).toHaveTextContent('1')

    fireEvent.click(screen.getByTestId('worktree-control-row-primary'))
    await waitFor(() => {
      expect(selectSessionFromSidebar).toHaveBeenCalledWith('host1')
    })
  })
})
