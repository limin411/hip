import { beforeEach, describe, expect, it, vi } from 'vitest'
import { worktreeProvider } from './worktree'
import type { ContextMenuBuildContext } from '../types'

const removeWorktree = vi.fn()
const deleteSession = vi.fn()
const selectSessionFromSidebar = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/domain', () => ({
  sessionService: {
    removeWorktree: (...a: unknown[]) => removeWorktree(...a),
    deleteSession: (...a: unknown[]) => deleteSession(...a),
  },
}))

vi.mock('@/components/layout/sidebarActions', () => ({
  selectSessionFromSidebar: (...a: unknown[]) => selectSessionFromSidebar(...a),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}))

function makeCtx(): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'code',
    surface: 'code',
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText: vi.fn(async () => true),
  }
}

describe('worktreeProvider', () => {
  beforeEach(() => {
    removeWorktree.mockReset()
    deleteSession.mockReset()
    selectSessionFromSidebar.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
  })

  it('offers open, copy path, remove, and force remove', () => {
    const items = worktreeProvider(
      {
        kind: 'worktree',
        payload: {
          hostSessionId: 'host',
          worktreePath: '/wt/a',
          label: 'branch-a',
          slotSessionId: 'slot-1',
        },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual([
      'worktree.openHost',
      'worktree.copyPath',
      'worktree.remove',
      'worktree.removeForce',
    ])
  })

  it('remove calls removeWorktree then deletes slot session', async () => {
    removeWorktree.mockResolvedValue({ ok: true })
    const items = worktreeProvider(
      {
        kind: 'worktree',
        payload: {
          hostSessionId: 'host',
          worktreePath: '/wt/a',
          label: 'branch-a',
          slotSessionId: 'slot-1',
        },
      },
      makeCtx(),
    )
    items.find((i) => i.id === 'worktree.remove')!.run()
    await vi.waitFor(() => {
      expect(removeWorktree).toHaveBeenCalledWith('host', '/wt/a', false)
      expect(deleteSession).toHaveBeenCalledWith(
        'slot-1',
        expect.objectContaining({ reason: 'worktree-menu' }),
      )
    })
  })

  it('force remove uses force:true', async () => {
    removeWorktree.mockResolvedValue({ ok: true })
    const items = worktreeProvider(
      {
        kind: 'worktree',
        payload: {
          hostSessionId: 'host',
          worktreePath: '/wt/a',
          label: 'branch-a',
        },
      },
      makeCtx(),
    )
    items.find((i) => i.id === 'worktree.removeForce')!.run()
    await vi.waitFor(() => {
      expect(removeWorktree).toHaveBeenCalledWith('host', '/wt/a', true)
    })
  })
})
