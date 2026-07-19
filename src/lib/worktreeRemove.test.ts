import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isWorktreeDirtyError,
  removeManagedWorktree,
} from './worktreeRemove'

describe('isWorktreeDirtyError', () => {
  it('matches sidecar dirty / uncommitted wording', () => {
    expect(
      isWorktreeDirtyError(
        'Worktree is dirty (uncommitted changes): /tmp/wt',
      ),
    ).toBe(true)
    expect(isWorktreeDirtyError('has uncommitted changes')).toBe(true)
    expect(isWorktreeDirtyError('DIRTY tree')).toBe(true)
  })

  it('prefers errorCode WORKTREE_DIRTY (PR7)', () => {
    expect(isWorktreeDirtyError(undefined, 'WORKTREE_DIRTY')).toBe(true)
    expect(isWorktreeDirtyError('something else', 'WORKTREE_DIRTY')).toBe(true)
    expect(isWorktreeDirtyError('not found', 'NOT_FOUND')).toBe(false)
    expect(isWorktreeDirtyError(undefined, 'UNKNOWN')).toBe(false)
  })

  it('is false for other errors and empty', () => {
    expect(isWorktreeDirtyError(undefined)).toBe(false)
    expect(isWorktreeDirtyError(null)).toBe(false)
    expect(isWorktreeDirtyError('')).toBe(false)
    expect(isWorktreeDirtyError('not found')).toBe(false)
    expect(isWorktreeDirtyError('NOT_MANAGED')).toBe(false)
  })
})

describe('removeManagedWorktree', () => {
  const removeWorktree = vi.fn()
  const deleteSession = vi.fn()

  beforeEach(() => {
    removeWorktree.mockReset()
    deleteSession.mockReset()
  })

  it('calls remove with force false by default and cleans slot session on success', async () => {
    removeWorktree.mockResolvedValue({ ok: true })
    const r = await removeManagedWorktree(
      {
        hostSessionId: 'host',
        worktreePath: '/wt/a',
        label: 'feat',
        slotSessionId: 'slot-1',
        reason: 'worktree-menu',
      },
      { removeWorktree, deleteSession },
    )
    expect(r).toEqual({ ok: true })
    expect(removeWorktree).toHaveBeenCalledWith('host', '/wt/a', false)
    expect(deleteSession).toHaveBeenCalledWith(
      'slot-1',
      expect.objectContaining({
        reason: 'worktree-menu',
        meta: expect.objectContaining({
          hostSessionId: 'host',
          worktreePath: '/wt/a',
          force: false,
        }),
      }),
    )
  })

  it('passes force true', async () => {
    removeWorktree.mockResolvedValue({ ok: true })
    await removeManagedWorktree(
      {
        hostSessionId: 'host',
        worktreePath: '/wt/a',
        force: true,
      },
      { removeWorktree, deleteSession },
    )
    expect(removeWorktree).toHaveBeenCalledWith('host', '/wt/a', true)
  })

  it('returns dirty:true without deleting session when preflight fails dirty', async () => {
    removeWorktree.mockResolvedValue({
      ok: false,
      error: 'Worktree is dirty (uncommitted changes): /wt/a',
    })
    const r = await removeManagedWorktree(
      {
        hostSessionId: 'host',
        worktreePath: '/wt/a',
        slotSessionId: 'slot-1',
      },
      { removeWorktree, deleteSession },
    )
    expect(r).toEqual({
      ok: false,
      dirty: true,
      error: 'Worktree is dirty (uncommitted changes): /wt/a',
    })
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it('returns dirty:true from errorCode even without dirty message (PR7)', async () => {
    removeWorktree.mockResolvedValue({
      ok: false,
      error: 'cannot remove',
      errorCode: 'WORKTREE_DIRTY',
      dirtySummary: ' M a.ts',
    })
    const r = await removeManagedWorktree(
      { hostSessionId: 'host', worktreePath: '/wt/a', slotSessionId: 'slot-1' },
      { removeWorktree, deleteSession },
    )
    expect(r).toEqual({
      ok: false,
      dirty: true,
      error: 'cannot remove',
      errorCode: 'WORKTREE_DIRTY',
      dirtySummary: ' M a.ts',
    })
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it('returns dirty:false for non-dirty failures', async () => {
    removeWorktree.mockResolvedValue({
      ok: false,
      error: 'not managed',
      errorCode: 'NOT_MANAGED',
    })
    const r = await removeManagedWorktree(
      { hostSessionId: 'host', worktreePath: '/wt/a' },
      { removeWorktree, deleteSession },
    )
    expect(r).toEqual({
      ok: false,
      dirty: false,
      error: 'not managed',
      errorCode: 'NOT_MANAGED',
    })
  })

  it('skips slot delete when no slotSessionId', async () => {
    removeWorktree.mockResolvedValue({ ok: true })
    await removeManagedWorktree(
      { hostSessionId: 'host', worktreePath: '/wt/a' },
      { removeWorktree, deleteSession },
    )
    expect(deleteSession).not.toHaveBeenCalled()
  })
})
