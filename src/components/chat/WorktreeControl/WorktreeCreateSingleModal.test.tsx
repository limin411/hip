// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { WorktreeCreateSingleModal } from './WorktreeCreateSingleModal'

const createManagedWorktree = vi.fn()

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: {
      ...actual.sessionService,
      createManagedWorktree: (...args: unknown[]) => createManagedWorktree(...args),
    },
  }
})

describe('WorktreeCreateSingleModal (PR4)', () => {
  beforeEach(async () => {
    cleanup()
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    createManagedWorktree.mockResolvedValue({
      ok: true,
      path: '/tmp/wt/hip-iso-abc123',
      id: 'wt1',
      sessionId: 'sess-new',
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows auto hip-iso-* branch preview with no free-typed branch input (D12)', () => {
    render(
      <WorktreeCreateSingleModal
        open
        onOpenChange={() => {}}
        hostSessionId="host1"
      />,
    )
    const branchEl = screen.getByTestId('worktree-create-single-branch')
    expect(branchEl.textContent).toMatch(/^hip-iso-[A-Za-z0-9_-]{6}$/)
    // No editable branch field
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(branchEl.tagName.toLowerCase()).not.toBe('input')
  })

  it('openSession defaults true and confirm calls createManagedWorktree with reveal true (D9/D23)', async () => {
    const onOpenChange = vi.fn()
    render(
      <WorktreeCreateSingleModal
        open
        onOpenChange={onOpenChange}
        hostSessionId="host1"
      />,
    )
    const toggle = screen.getByTestId('worktree-create-single-open-session')
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    const branch = screen.getByTestId('worktree-create-single-branch').textContent!
    fireEvent.click(screen.getByTestId('worktree-create-single-confirm'))

    await waitFor(() => {
      expect(createManagedWorktree).toHaveBeenCalledTimes(1)
    })
    expect(createManagedWorktree).toHaveBeenCalledWith({
      hostSessionId: 'host1',
      branch,
      createBranch: true,
      pathKey: branch,
      openSession: true,
      reveal: true,
    })
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('does not toast success on create (D23 — effects own reveal:true toast)', async () => {
    const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => '')
    const toastMessage = vi.spyOn(toast, 'message').mockImplementation(() => '')
    render(
      <WorktreeCreateSingleModal
        open
        onOpenChange={() => {}}
        hostSessionId="host1"
      />,
    )
    fireEvent.click(screen.getByTestId('worktree-create-single-confirm'))
    await waitFor(() => {
      expect(createManagedWorktree).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(createManagedWorktree.mock.results[0]?.value).toBeTruthy()
    })
    // Allow microtasks from success path
    await waitFor(() => {
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastMessage).not.toHaveBeenCalled()
    })
    toastSuccess.mockRestore()
    toastMessage.mockRestore()
  })

  it('toggle openSession false passes openSession: false', async () => {
    render(
      <WorktreeCreateSingleModal
        open
        onOpenChange={() => {}}
        hostSessionId="host1"
      />,
    )
    fireEvent.click(screen.getByTestId('worktree-create-single-open-session'))
    expect(screen.getByTestId('worktree-create-single-open-session')).toHaveAttribute(
      'aria-checked',
      'false',
    )
    fireEvent.click(screen.getByTestId('worktree-create-single-confirm'))
    await waitFor(() => {
      expect(createManagedWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ openSession: false, reveal: true }),
      )
    })
  })

  it('non-git create error invokes onNonGitError, locks confirm, and closes modal (D24)', async () => {
    createManagedWorktree.mockResolvedValue({
      ok: false,
      error: 'not_a_repo',
    })
    const onNonGitError = vi.fn()
    const onOpenChange = vi.fn()
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '')
    render(
      <WorktreeCreateSingleModal
        open
        onOpenChange={onOpenChange}
        hostSessionId="host1"
        onNonGitError={onNonGitError}
      />,
    )
    fireEvent.click(screen.getByTestId('worktree-create-single-confirm'))
    await waitFor(() => {
      expect(onNonGitError).toHaveBeenCalledTimes(1)
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toastError).toHaveBeenCalled()
    // Confirm stays disabled if parent has not unmounted yet (no re-submit).
    expect(screen.getByTestId('worktree-create-single-confirm')).toBeDisabled()
    // Only one create attempt
    expect(createManagedWorktree).toHaveBeenCalledTimes(1)
    toastError.mockRestore()
  })

  it('does not set non-git for unrelated create errors', async () => {
    createManagedWorktree.mockResolvedValue({
      ok: false,
      error: 'worktree already exists',
    })
    const onNonGitError = vi.fn()
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '')
    render(
      <WorktreeCreateSingleModal
        open
        onOpenChange={() => {}}
        hostSessionId="host1"
        onNonGitError={onNonGitError}
      />,
    )
    fireEvent.click(screen.getByTestId('worktree-create-single-confirm'))
    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    expect(onNonGitError).not.toHaveBeenCalled()
    toastError.mockRestore()
  })

  it('has no durable label field (label not durable in v1)', () => {
    render(
      <WorktreeCreateSingleModal
        open
        onOpenChange={() => {}}
        hostSessionId="host1"
      />,
    )
    expect(screen.queryByLabelText(/label/i)).toBeNull()
    expect(screen.queryByPlaceholderText(/label/i)).toBeNull()
  })
})
