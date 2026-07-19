// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { WorktreeParallelModal } from './WorktreeParallelModal'
import * as domain from '@/domain'
import { sessionService } from '@/domain'
import { useParallelStore } from '@/store/parallelStore'

vi.mock('sonner', () => ({
  toast: {
    message: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('WorktreeParallelModal', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useParallelStore.setState({ runs: [] })
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 'host-1',
      config: {
        surface: 'code',
        cwd: '/repo',
        permissionMode: 'edit',
      },
      title: 'Host',
      preview: '',
      updatedAtMs: 0,
      loaded: true,
      messages: [],
      status: 'idle',
      error: null,
    } as unknown as NonNullable<ReturnType<typeof domain.useActiveSession>>)
  })

  it('keeps parallel-run-* testids and shows suggest N for compare goal', () => {
    render(
      <WorktreeParallelModal
        open
        onOpenChange={vi.fn()}
        draftPrompt=""
        hostSessionId="host-1"
        baseCwd="/repo"
      />,
    )
    const ta = screen.getByTestId('parallel-run-prompt')
    fireEvent.change(ta, { target: { value: 'compare two approaches for caching' } })
    const chip = screen.getByTestId('parallel-run-suggestion')
    expect(chip).toHaveAttribute('data-suggest-n', '2')
    expect(screen.getByTestId('parallel-run-confirm')).toBeInTheDocument()
  })

  it('prefills draftPrompt when opened', () => {
    render(
      <WorktreeParallelModal
        open
        onOpenChange={vi.fn()}
        draftPrompt="  compare A and B  "
        hostSessionId="host-1"
        baseCwd="/repo"
      />,
    )
    expect(screen.getByTestId('parallel-run-prompt')).toHaveValue('compare A and B')
  })

  it('calls startParallelRun with autoSend:false and host overrides; one summary path', async () => {
    const start = vi.spyOn(sessionService, 'startParallelRun').mockResolvedValue({
      runId: 'runabcdefgh',
      slotSessionIds: ['s1', 's2'],
      slotPaths: ['/wt/a', '/wt/b'],
    })
    const onOpenChange = vi.fn()
    const { toast } = await import('sonner')

    render(
      <WorktreeParallelModal
        open
        onOpenChange={onOpenChange}
        draftPrompt="compare two approaches"
        hostSessionId="host-1"
        baseCwd="/repo"
      />,
    )

    fireEvent.click(screen.getByTestId('parallel-run-confirm'))

    await waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1)
    })
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'compare two approaches',
        baseCwd: '/repo',
        hostSessionId: 'host-1',
        autoSend: false,
        count: 2,
      }),
    )
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps modal open and lists slot errors on partial failure', async () => {
    vi.spyOn(sessionService, 'startParallelRun').mockImplementation(async () => {
      useParallelStore.setState({
        runs: [
          {
            id: 'runpartial1',
            baseCwd: '/repo',
            prompt: 'compare',
            hostSessionId: 'host-1',
            source: 'host',
            createdAt: Date.now(),
            slots: [
              {
                index: 1,
                sessionId: 's1',
                worktreePath: '/wt/a',
                branch: 'hip-p-runpar-1',
                status: 'ready',
              },
              {
                index: 2,
                sessionId: '',
                worktreePath: '',
                branch: 'hip-p-runpar-2',
                status: 'error',
                error: 'disk full',
              },
            ],
          },
        ],
      })
      return {
        runId: 'runpartial1',
        slotSessionIds: ['s1'],
        slotPaths: ['/wt/a'],
      }
    })
    const onOpenChange = vi.fn()
    const { toast } = await import('sonner')

    render(
      <WorktreeParallelModal
        open
        onOpenChange={onOpenChange}
        draftPrompt="compare two"
        hostSessionId="host-1"
        baseCwd="/repo"
      />,
    )
    fireEvent.click(screen.getByTestId('parallel-run-confirm'))

    await waitFor(() => {
      expect(screen.getByTestId('parallel-run-slot-errors')).toBeInTheDocument()
    })
    expect(screen.getByTestId('parallel-run-slot-errors').textContent).toMatch(/hip-p-runpar-2/)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(toast.success).toHaveBeenCalledTimes(1)
  })
})
