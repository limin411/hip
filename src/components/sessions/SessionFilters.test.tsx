// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionFilters } from './SessionFilters'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => cleanup())

describe('SessionFilters', () => {
  it('renders all three filter tabs', () => {
    render(<SessionFilters value="all" onChange={vi.fn()} />)
    expect(screen.getByText('sidebar.filterAll')).toBeInTheDocument()
    expect(screen.getByText('sidebar.filterChat')).toBeInTheDocument()
    expect(screen.getByText('sidebar.filterCode')).toBeInTheDocument()
  })

  it('calls onChange when a different tab is clicked', () => {
    const onChange = vi.fn()
    render(<SessionFilters value="all" onChange={onChange} />)
    fireEvent.mouseDown(screen.getByText('sidebar.filterCode'))
    expect(onChange).toHaveBeenCalledWith('code')
  })
})
