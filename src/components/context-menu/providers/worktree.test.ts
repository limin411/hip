import { beforeEach, describe, expect, it, vi } from 'vitest'
import { worktreeProvider } from './worktree'
import type { ContextMenuBuildContext } from '../types'

const openWorktreeDeleteDialog = vi.fn()
const openWorktreeSession = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/components/chat/WorktreeControl/worktreeDeleteDialogStore', () => ({
  openWorktreeDeleteDialog: (...a: unknown[]) => openWorktreeDeleteDialog(...a),
}))

vi.mock('@/lib/worktreeOpenAction', () => ({
  openWorktreeSession: (...a: unknown[]) => openWorktreeSession(...a),
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
    openWorktreeDeleteDialog.mockReset()
    openWorktreeSession.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
  })

  it('offers open, copy path, and remove (confirm dialog — no direct force menu)', () => {
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
    ])
  })

  it('remove opens shared delete confirm dialog (does not remove immediately)', () => {
    const items = worktreeProvider(
      {
        kind: 'worktree',
        payload: {
          hostSessionId: 'host',
          worktreePath: '/wt/a',
          label: 'branch-a',
          branch: 'hip-iso-a',
          slotSessionId: 'slot-1',
        },
      },
      makeCtx(),
    )
    items.find((i) => i.id === 'worktree.remove')!.run()
    expect(openWorktreeDeleteDialog).toHaveBeenCalledWith({
      hostSessionId: 'host',
      worktreePath: '/wt/a',
      label: 'branch-a',
      branch: 'hip-iso-a',
      slotSessionId: 'slot-1',
      reason: 'worktree-menu',
    })
  })

  it('open resolves worktree session via openWorktreeSession', () => {
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
    items.find((i) => i.id === 'worktree.openHost')!.run()
    expect(openWorktreeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/wt/a',
        hostSessionId: 'host',
        slotSessionId: 'slot-1',
      }),
    )
  })
})
