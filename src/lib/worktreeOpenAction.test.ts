import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useParallelStore } from '@/store/parallelStore'
import { useWorktreeStore } from '@/store/worktreeStore'
import { openWorktreeSession } from './worktreeOpenAction'

const selectSessionFromSidebar = vi.fn(async (_id: string) => {})
const toastMessage = vi.fn()
const createSession = vi.fn((_config?: unknown) => 'new-sess')

vi.mock('@/components/layout/sidebarActions', () => ({
  selectSessionFromSidebar: (id: string) => selectSessionFromSidebar(id),
}))

vi.mock('sonner', () => ({
  toast: {
    message: (...a: unknown[]) => toastMessage(...a),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: {
      ...actual.sessionService,
      createSession: (config: unknown) => createSession(config),
    },
  }
})

const t = (key: string) => key

describe('openWorktreeSession', () => {
  beforeEach(() => {
    selectSessionFromSidebar.mockClear()
    toastMessage.mockClear()
    createSession.mockClear()
    useParallelStore.setState({ runs: [] })
    useWorktreeStore.getState().clear()
    useDomainStore.setState({
      sessions: [
        {
          id: 'host',
          title: 'Host',
          preview: '',
          updatedAtMs: 1,
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/repo' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
        {
          id: 'wt-sess',
          title: 'WT',
          preview: '',
          updatedAtMs: 2,
          config: {
            ...DEFAULT_CONFIG,
            surface: 'code',
            cwd: '/Users/x/.hip/worktrees/repo-p1',
          },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'host',
    } as never)
  })

  it('selects the session bound to the worktree path (not the host)', async () => {
    await openWorktreeSession({
      path: '/Users/x/.hip/worktrees/repo-p1',
      hostSessionId: 'host',
      t,
    })
    expect(selectSessionFromSidebar).toHaveBeenCalledWith('wt-sess')
    expect(toastMessage).not.toHaveBeenCalled()
  })

  it('prefers explicit slotSessionId', async () => {
    await openWorktreeSession({
      path: '/Users/x/.hip/worktrees/repo-p1',
      hostSessionId: 'host',
      slotSessionId: 'wt-sess',
      t,
    })
    expect(selectSessionFromSidebar).toHaveBeenCalledWith('wt-sess')
  })

  it('toasts when no session is bound', async () => {
    await openWorktreeSession({
      path: '/Users/x/.hip/worktrees/orphan',
      hostSessionId: 'host',
      t,
    })
    expect(selectSessionFromSidebar).not.toHaveBeenCalled()
    expect(toastMessage).toHaveBeenCalled()
    expect(toastMessage.mock.calls[0]![0]).toBe('chat.worktreeControl.noSessionToast')
  })
})
