// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionTab } from './SessionTab'
import type { SessionVM } from '@/domain'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

type MenuProps = {
  kind: string
  payload: unknown
  children: React.ReactNode
  className?: string
}

let lastMenuProps: MenuProps | null = null

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: (props: MenuProps) => {
    lastMenuProps = props
    // Pass-through: when CONTEXT_MENUS is off, host returns children only.
    return <>{props.children}</>
  },
}))

const session = {
  id: 's1',
  title: 'Test Session',
  config: { surface: 'chat' },
} as unknown as SessionVM

describe('SessionTab', () => {
  afterEach(() => {
    lastMenuProps = null
  })

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

  it('renders capsule shape and active state classes on permanent outer chrome', () => {
    render(<SessionTab session={session} active onSelect={vi.fn()} onClose={vi.fn()} />)
    const tab = screen.getByTestId('session-tab-container')
    expect(tab).toHaveClass('rounded-md')
    expect(tab).toHaveClass('bg-state-active')
    expect(tab).toHaveClass('text-ink')
    expect(tab).toHaveAttribute('data-tauri-drag-region', 'false')
  })

  it('renders inactive state classes on permanent outer chrome', () => {
    render(<SessionTab session={session} active={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    const tab = screen.getByTestId('session-tab-container')
    expect(tab).toHaveClass('rounded-md')
    expect(tab).toHaveClass('text-ink-secondary')
    expect(tab).not.toHaveClass('bg-state-active')
  })

  it('wires DeclarativeContextMenu with sessionTab kind and payload', () => {
    render(<SessionTab session={session} active={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(lastMenuProps?.kind).toBe('sessionTab')
    expect(lastMenuProps?.payload).toEqual({
      sessionId: 's1',
      title: 'Test Session',
      surface: 'chat',
    })
  })

  it('keeps chrome classes when context menu host is a pass-through (feature-off shape)', () => {
    // Mock returns children only — same as CONTEXT_MENUS=false.
    render(<SessionTab session={session} active onSelect={vi.fn()} onClose={vi.fn()} />)
    const outer = screen.getByTestId('session-tab-container')
    expect(outer).toHaveClass('group', 'h-[28px]', 'min-w-[140px]', 'bg-state-active')
    expect(screen.getByTestId('session-tab')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })
})
