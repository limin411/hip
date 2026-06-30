// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@/i18n'
import { PlanApprovalCard } from './PlanApprovalCard'

describe('PlanApprovalCard', () => {
  beforeEach(() => {
    cleanup()
  })

  const plan = [
    { content: 'Step one', status: 'completed' },
    { content: 'Step two', status: 'pending' },
  ] as any

  it('renders plan items', () => {
    render(<PlanApprovalCard plan={plan} onApprove={vi.fn()} onReject={vi.fn()} onAmend={vi.fn()} />)
    expect(screen.getByText('Step one')).toBeInTheDocument()
    expect(screen.getByText('Step two')).toBeInTheDocument()
  })

  it('calls onApprove when approve is clicked', () => {
    const onApprove = vi.fn()
    render(<PlanApprovalCard plan={plan} onApprove={onApprove} onReject={vi.fn()} onAmend={vi.fn()} />)
    fireEvent.click(screen.getByTestId('plan-approve'))
    expect(onApprove).toHaveBeenCalled()
  })

  it('calls onReject when reject is clicked', () => {
    const onReject = vi.fn()
    render(<PlanApprovalCard plan={plan} onApprove={vi.fn()} onReject={onReject} onAmend={vi.fn()} />)
    fireEvent.click(screen.getByTestId('plan-reject'))
    expect(onReject).toHaveBeenCalled()
  })

  it('switches to amend mode and submits amendment', () => {
    const onAmend = vi.fn()
    render(<PlanApprovalCard plan={plan} onApprove={vi.fn()} onReject={vi.fn()} onAmend={onAmend} />)
    fireEvent.click(screen.getByTestId('plan-amend'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'change step two' } })
    fireEvent.click(screen.getByTestId('plan-amend-submit'))
    expect(onAmend).toHaveBeenCalledWith('change step two')
  })
})
