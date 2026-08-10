// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TerminalSearchBar } from './TerminalSearchBar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('TerminalSearchBar', () => {
  const base = {
    query: 'term',
    onQueryChange: vi.fn(),
    matchIndex: 2,
    matchCount: 5,
    caseSensitive: false,
    onToggleCase: vi.fn(),
    onStep: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    cleanup()
    base.onQueryChange.mockReset()
    base.onToggleCase.mockReset()
    base.onStep.mockReset()
    base.onClose.mockReset()
  })

  it('renders query, match count and controls', () => {
    render(<TerminalSearchBar {...base} />)
    expect(screen.getByTestId('terminal-searchbar')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-searchbar-input')).toHaveValue('term')
    expect(screen.getByTestId('terminal-searchbar-count')).toHaveTextContent('2 / 5')
    expect(screen.getByTestId('terminal-searchbar-case')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-searchbar-prev')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-searchbar-next')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-searchbar-close')).toBeInTheDocument()
  })

  it('shows 0 / 0 when no matches', () => {
    render(<TerminalSearchBar {...base} matchIndex={0} matchCount={0} />)
    expect(screen.getByTestId('terminal-searchbar-count')).toHaveTextContent('0 / 0')
  })

  it('forwards query edits', () => {
    render(<TerminalSearchBar {...base} />)
    fireEvent.change(screen.getByTestId('terminal-searchbar-input'), { target: { value: 'ring' } })
    expect(base.onQueryChange).toHaveBeenCalledWith('ring')
  })

  it('Enter steps forward, Shift+Enter backward', () => {
    render(<TerminalSearchBar {...base} />)
    fireEvent.keyDown(screen.getByTestId('terminal-searchbar-input'), { key: 'Enter' })
    expect(base.onStep).toHaveBeenCalledWith(1)
    fireEvent.keyDown(screen.getByTestId('terminal-searchbar-input'), { key: 'Enter', shiftKey: true })
    expect(base.onStep).toHaveBeenCalledWith(-1)
  })

  it('Escape closes', () => {
    render(<TerminalSearchBar {...base} />)
    fireEvent.keyDown(screen.getByTestId('terminal-searchbar-input'), { key: 'Escape' })
    expect(base.onClose).toHaveBeenCalled()
  })

  it('case / step / close buttons call their handlers', () => {
    render(<TerminalSearchBar {...base} />)
    fireEvent.click(screen.getByTestId('terminal-searchbar-case'))
    expect(base.onToggleCase).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('terminal-searchbar-prev'))
    expect(base.onStep).toHaveBeenCalledWith(-1)
    fireEvent.click(screen.getByTestId('terminal-searchbar-next'))
    expect(base.onStep).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByTestId('terminal-searchbar-close'))
    expect(base.onClose).toHaveBeenCalled()
  })
})
