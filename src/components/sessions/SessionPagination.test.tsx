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
    expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
  })

  it('disables previous on first page', () => {
    render(<SessionPagination page={1} totalPages={3} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
  })

  it('calls onChange with next page', () => {
    const onChange = vi.fn()
    render(<SessionPagination page={1} totalPages={3} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(onChange).toHaveBeenCalledWith(2)
  })
})
