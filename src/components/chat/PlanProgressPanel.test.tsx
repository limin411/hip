// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@/i18n'
import { PlanProgressPanel } from './PlanProgressPanel'
import type { LivePlanView } from '@/lib/todos'

function view(over: Partial<LivePlanView> = {}): LivePlanView {
  return {
    items: [
      { content: 'Step one', status: 'completed' },
      { content: 'Step two', status: 'in_progress' },
    ],
    phase: 'executing',
    source: 'write_todos',
    progress: { done: 1, total: 2, current: 'Step two' },
    ...over,
  }
}

describe('PlanProgressPanel', () => {
  beforeEach(() => cleanup())

  it('renders checklist, progress count, and current item', () => {
    render(<PlanProgressPanel view={view()} />)
    expect(screen.getByTestId('plan-progress-panel')).toBeInTheDocument()
    expect(screen.getByTestId('todo-checklist')).toBeInTheDocument()
    expect(screen.getByText('Step one')).toBeInTheDocument()
    expect(screen.getAllByText('Step two').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('plan-progress-count')).toBeInTheDocument()
    expect(screen.getByTestId('plan-progress-current')).toHaveTextContent('Step two')
  })

  it('shows empty planning state', () => {
    render(
      <PlanProgressPanel
        view={view({
          items: [],
          phase: 'planning',
          source: 'empty',
          progress: { done: 0, total: 0 },
        })}
      />,
    )
    expect(screen.getByTestId('plan-progress-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('todo-checklist')).not.toBeInTheDocument()
  })

  it('shows empty awaiting state with Approve/Reject/Amend buttons', () => {
    render(
      <PlanProgressPanel
        view={view({
          items: [],
          phase: 'awaiting_approval',
          source: 'empty',
          progress: { done: 0, total: 0 },
        })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onAmend={vi.fn()}
      />,
    )
    expect(screen.getByTestId('plan-progress-empty-awaiting')).toBeInTheDocument()
    expect(screen.queryByTestId('todo-checklist')).not.toBeInTheDocument()
    expect(screen.getByTestId('plan-approval-card')).toBeInTheDocument()
    expect(screen.getByTestId('plan-approve')).toBeInTheDocument()
    expect(screen.getByTestId('plan-reject')).toBeInTheDocument()
    expect(screen.getByTestId('plan-amend')).toBeInTheDocument()
  })

  it('shows approval actions and calls onApprove', () => {
    const onApprove = vi.fn()
    render(
      <PlanProgressPanel
        view={view({ phase: 'awaiting_approval', source: 'activeTurnPlan' })}
        onApprove={onApprove}
        onReject={vi.fn()}
        onAmend={vi.fn()}
      />,
    )
    expect(screen.getByTestId('plan-approval-card')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('plan-approve'))
    expect(onApprove).toHaveBeenCalled()
  })

  it('submits amend text', () => {
    const onAmend = vi.fn()
    render(
      <PlanProgressPanel
        view={view({ phase: 'awaiting_approval', source: 'activeTurnPlan' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onAmend={onAmend}
      />,
    )
    fireEvent.click(screen.getByTestId('plan-amend'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'change step two' } })
    fireEvent.click(screen.getByTestId('plan-amend-submit'))
    expect(onAmend).toHaveBeenCalledWith('change step two')
  })

  it('KD-16: re-enables Approve after phase leaves and re-enters awaiting_approval (ok:false rollback)', () => {
    const onApprove = vi.fn()
    const awaiting = view({ phase: 'awaiting_approval', source: 'activeTurnPlan' })
    const executing = view({ phase: 'executing', source: 'activeTurnPlan' })
    const { rerender } = render(
      <PlanProgressPanel view={awaiting} onApprove={onApprove} onReject={vi.fn()} onAmend={vi.fn()} />,
    )
    fireEvent.click(screen.getByTestId('plan-approve'))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('plan-approve')).toBeDisabled()

    // Optimistic: store cleared pending → phase executing (panel stays mounted).
    rerender(
      <PlanProgressPanel view={executing} onApprove={onApprove} onReject={vi.fn()} onAmend={vi.fn()} />,
    )
    expect(screen.queryByTestId('plan-approve')).not.toBeInTheDocument()

    // plan:respond:result ok:false → pending restored → awaiting again.
    rerender(
      <PlanProgressPanel view={awaiting} onApprove={onApprove} onReject={vi.fn()} onAmend={vi.fn()} />,
    )
    const approve = screen.getByTestId('plan-approve')
    expect(approve).not.toBeDisabled()
    fireEvent.click(approve)
    expect(onApprove).toHaveBeenCalledTimes(2)
  })
})
