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

  it('renders compact header with progress; expands to show checklist', () => {
    render(<PlanProgressPanel view={view()} />)
    expect(screen.getByTestId('plan-progress-panel')).toBeInTheDocument()
    expect(screen.getByTestId('plan-progress-panel')).toHaveAttribute('data-expanded', 'false')
    // Collapsed: checklist hidden, current item on the header row
    expect(screen.queryByTestId('todo-checklist')).not.toBeInTheDocument()
    expect(screen.getByTestId('plan-progress-count')).toBeInTheDocument()
    expect(screen.getByTestId('plan-progress-current')).toHaveTextContent('Step two')

    fireEvent.click(screen.getByTestId('plan-progress-toggle'))
    expect(screen.getByTestId('plan-progress-panel')).toHaveAttribute('data-expanded', 'true')
    expect(screen.getByTestId('todo-checklist')).toBeInTheDocument()
    expect(screen.getByText('Step one')).toBeInTheDocument()
    expect(screen.getAllByText('Step two').length).toBeGreaterThanOrEqual(1)
  })

  it('defaults expanded while awaiting approval', () => {
    render(
      <PlanProgressPanel
        view={view({ phase: 'awaiting_approval', source: 'activeTurnPlan' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onAmend={vi.fn()}
      />,
    )
    expect(screen.getByTestId('plan-progress-panel')).toHaveAttribute('data-expanded', 'true')
    expect(screen.getByTestId('todo-checklist')).toBeInTheDocument()
  })

  it('shows empty planning state when expanded', () => {
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
    // planning defaults collapsed
    expect(screen.queryByTestId('plan-progress-empty')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('plan-progress-toggle'))
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

  it('renders markdown preview above checklist when markdown present', () => {
    render(
      <PlanProgressPanel
        view={view({
          phase: 'awaiting_approval',
          source: 'activeTurnPlan',
          markdown: '## Context\n\nDo the work carefully.',
          planPath: '/Users/me/.hip/plans/s1.md',
        })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onAmend={vi.fn()}
      />,
    )
    expect(screen.getByTestId('plan-markdown-preview')).toBeInTheDocument()
    expect(screen.getByTestId('plan-markdown-body')).toHaveTextContent('Context')
    expect(screen.getByTestId('plan-markdown-body')).toHaveTextContent('Do the work carefully')
    expect(screen.getByTestId('todo-checklist')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-progress-empty-markdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plan-progress-empty-checklist')).not.toBeInTheDocument()
  })

  it('shows emptyChecklist when markdown-only awaiting', () => {
    render(
      <PlanProgressPanel
        view={view({
          items: [],
          phase: 'awaiting_approval',
          source: 'empty',
          progress: { done: 0, total: 0 },
          markdown: '## Narrative only',
        })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onAmend={vi.fn()}
      />,
    )
    expect(screen.getByTestId('plan-markdown-preview')).toBeInTheDocument()
    expect(screen.getByTestId('plan-progress-empty-checklist')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-progress-empty-awaiting')).not.toBeInTheDocument()
  })

  it('shows emptyMarkdown when todos-only awaiting', () => {
    render(
      <PlanProgressPanel
        view={view({ phase: 'awaiting_approval', source: 'activeTurnPlan' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onAmend={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('plan-markdown-preview')).not.toBeInTheDocument()
    expect(screen.getByTestId('plan-progress-empty-markdown')).toBeInTheDocument()
    expect(screen.getByTestId('todo-checklist')).toBeInTheDocument()
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
