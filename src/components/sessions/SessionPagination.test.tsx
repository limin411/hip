// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SessionPagination } from './SessionPagination'

afterEach(() => cleanup())

describe('SessionPagination', () => {
  it('renders nothing when there is only one page', () => {
    const { container } = render(<SessionPagination page={1} totalPages={1} onChange={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders page info and buttons', () => {
    render(<SessionPagination page={2} totalPages={3} onChange={vi.fn()} />)
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByTestId('pagination-previous')).toBeInTheDocument()
    expect(screen.getByTestId('pagination-next')).toBeInTheDocument()
  })

  it('disables previous on first page', () => {
    render(<SessionPagination page={1} totalPages={3} onChange={vi.fn()} />)
    expect(screen.getByTestId('pagination-previous')).toBeDisabled()
  })

  it('calls onChange with next page', () => {
    const onChange = vi.fn()
    render(<SessionPagination page={1} totalPages={3} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('pagination-next'))
    expect(onChange).toHaveBeenCalledWith(2)
  })
})
