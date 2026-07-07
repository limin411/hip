// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Pagination } from './Pagination'

afterEach(() => {
  cleanup()
})

describe('Pagination', () => {
  it('renders page numbers', () => {
    render(<Pagination currentPage={1} totalPages={5} onChange={vi.fn()} />)
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByText(String(i))).toBeInTheDocument()
    }
  })

  it('calls onChange when a page is clicked', () => {
    const onChange = vi.fn()
    render(<Pagination currentPage={1} totalPages={5} onChange={onChange} />)
    fireEvent.click(screen.getByText('3'))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('disables previous button on the first page', () => {
    render(<Pagination currentPage={1} totalPages={5} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
    expect(screen.getByLabelText('Next page')).not.toBeDisabled()
  })

  it('disables next button on the last page', () => {
    render(<Pagination currentPage={5} totalPages={5} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Previous page')).not.toBeDisabled()
    expect(screen.getByLabelText('Next page')).toBeDisabled()
  })

  it('shows ellipsis for many pages', () => {
    render(<Pagination currentPage={5} totalPages={10} onChange={vi.fn()} />)
    expect(screen.getAllByText('…')).toHaveLength(2)
  })
})
