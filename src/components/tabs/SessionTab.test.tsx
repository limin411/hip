// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionTab } from './SessionTab'
import type { SessionVM } from '@/domain'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const session = {
  id: 's1',
  title: 'Test Session',
  config: { surface: 'chat' },
} as unknown as SessionVM

describe('SessionTab', () => {
  it('renders title and surface icon', () => {
    render(<SessionTab session={session} active={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Test Session')).toBeInTheDocument()
    expect(screen.getByTestId('surface-icon')).toBeInTheDocument()
  })

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    render(<SessionTab session={session} active={false} onSelect={onSelect} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Test Session', { selector: 'span' }))
    expect(onSelect).toHaveBeenCalled()
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<SessionTab session={session} active={false} onSelect={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders capsule shape and active state classes', () => {
    render(<SessionTab session={session} active onSelect={vi.fn()} onClose={vi.fn()} />)
    const tab = screen.getByTestId('session-tab-container')
    expect(tab).toHaveClass('rounded-md')
    expect(tab).toHaveClass('bg-state-active')
    expect(tab).toHaveClass('text-ink')
  })

  it('renders inactive state classes', () => {
    render(<SessionTab session={session} active={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    const tab = screen.getByTestId('session-tab-container')
    expect(tab).toHaveClass('rounded-md')
    expect(tab).toHaveClass('text-ink-secondary')
    expect(tab).not.toHaveClass('bg-state-active')
  })
})
