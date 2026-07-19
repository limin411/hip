// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { WorktreeDeleteDialog } from './WorktreeDeleteDialog'
import type { WorktreeDeleteTarget } from './worktreeDeleteDialogStore'

const removeManagedWorktree = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
  }),
}))

vi.mock('@/lib/worktreeRemove', () => ({
  removeManagedWorktree: (...a: unknown[]) => removeManagedWorktree(...a),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}))

const target: WorktreeDeleteTarget = {
  hostSessionId: 'host',
  worktreePath: '/repo/.hip/worktrees/a',
  label: 'feat-a',
  branch: 'hip-iso-abc',
  slotSessionId: 'slot-1',
  reason: 'test',
}

describe('WorktreeDeleteDialog', () => {
  beforeEach(() => {
    removeManagedWorktree.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows cascade note and no checkbox; confirms with non-force remove', async () => {
    const onClose = vi.fn()
    removeManagedWorktree.mockResolvedValue({ ok: true })

    render(<WorktreeDeleteDialog target={target} onClose={onClose} />)

    expect(screen.getByTestId('worktree-delete-cascade')).toHaveTextContent(
      'chat.worktreeControl.delete.cascadeNote',
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByTestId('worktree-delete-path').textContent).toContain(
      '/repo/.hip/worktrees/a',
    )
    expect(screen.getByTestId('worktree-delete-branch').textContent).toContain('hip-iso-abc')

    fireEvent.click(screen.getByTestId('worktree-delete-confirm'))

    await waitFor(() => {
      expect(removeManagedWorktree).toHaveBeenCalledWith(
        expect.objectContaining({
          hostSessionId: 'host',
          worktreePath: '/repo/.hip/worktrees/a',
          force: false,
          slotSessionId: 'slot-1',
        }),
      )
      expect(onClose).toHaveBeenCalled()
      expect(toastSuccess).toHaveBeenCalled()
    })
  })

  it('upgrades to force button on dirty without file count', async () => {
    const onClose = vi.fn()
    removeManagedWorktree
      .mockResolvedValueOnce({
        ok: false,
        dirty: true,
        error: 'Worktree is dirty (uncommitted changes): /repo/.hip/worktrees/a',
      })
      .mockResolvedValueOnce({ ok: true })

    render(<WorktreeDeleteDialog target={target} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('worktree-delete-confirm'))

    await waitFor(() => {
      expect(screen.getByTestId('worktree-delete-dirty')).toBeInTheDocument()
      expect(screen.getByTestId('worktree-delete-force')).toBeInTheDocument()
    })
    // No file-count UX
    expect(screen.getByTestId('worktree-delete-dirty').textContent).not.toMatch(/\d+\s*file/i)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('worktree-delete-force'))

    await waitFor(() => {
      expect(removeManagedWorktree).toHaveBeenLastCalledWith(
        expect.objectContaining({ force: true }),
      )
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('toasts non-dirty failure without entering force mode', async () => {
    const onClose = vi.fn()
    removeManagedWorktree.mockResolvedValue({
      ok: false,
      dirty: false,
      error: 'not managed',
    })

    render(<WorktreeDeleteDialog target={target} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('worktree-delete-confirm'))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('worktree-delete-force')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})
