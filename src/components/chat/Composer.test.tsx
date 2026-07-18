// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@/i18n'
import { Composer } from './Composer'

describe('Composer', () => {
  beforeEach(() => {
    cleanup()
  })
  it('renders textarea and disabled send when empty', () => {
    render(<Composer value="" onChange={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByPlaceholderText(/Message hip/)).toBeInTheDocument()
    expect(screen.getByTestId('composer-send')).toBeDisabled()
  })

  it('calls onChange when typing', () => {
    const onChange = vi.fn()
    render(<Composer value="" onChange={onChange} onSubmit={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/Message hip/), { target: { value: 'hi' } })
    expect(onChange).toHaveBeenCalledWith('hi')
  })

  it('calls onSubmit when send is clicked', () => {
    const onSubmit = vi.fn()
    render(<Composer value="hello" onChange={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByTestId('composer-send'))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('submits on Enter without shift', () => {
    const onSubmit = vi.fn()
    render(<Composer value="hello" onChange={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.keyDown(screen.getByPlaceholderText(/Message hip/), { key: 'Enter', shiftKey: false })
    expect(onSubmit).toHaveBeenCalled()
  })

  it('does not submit on shift+Enter', () => {
    const onSubmit = vi.fn()
    render(<Composer value="hello" onChange={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.keyDown(screen.getByPlaceholderText(/Message hip/), { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders attachment chips and removes them', () => {
    const onAttachmentsChange = vi.fn()
    const attachments = [{ id: 'a1', name: 'file.png', mimeType: 'image/png', path: '/tmp/file.png' }]
    render(
      <Composer
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        attachments={attachments}
        onAttachmentsChange={onAttachmentsChange}
      />,
    )
    expect(screen.getByTestId('attachment-chip')).toHaveTextContent('file.png')
    fireEvent.click(screen.getByTestId('attachment-remove'))
    expect(onAttachmentsChange).toHaveBeenCalledWith([])
  })

  it('shows stop button while running', () => {
    const onStop = vi.fn()
    render(<Composer value="" onChange={vi.fn()} onSubmit={vi.fn()} running onStop={onStop} />)
    fireEvent.click(screen.getByTestId('composer-stop'))
    expect(onStop).toHaveBeenCalled()
  })

  it('renders quote chip with one-line preview and clears it', () => {
    const onQuoteClear = vi.fn()
    render(
      <Composer
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        quoteText={'line one\nline two'}
        onQuoteClear={onQuoteClear}
      />,
    )
    const chip = screen.getByTestId('composer-quote')
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveTextContent('line one line two')
    fireEvent.click(screen.getByTestId('composer-quote-remove'))
    expect(onQuoteClear).toHaveBeenCalled()
  })

  it('hides quote chip when quoteText is empty', () => {
    render(<Composer value="" onChange={vi.fn()} onSubmit={vi.fn()} quoteText="   " />)
    expect(screen.queryByTestId('composer-quote')).not.toBeInTheDocument()
  })

  it('card variant uses rounded rectangle shell', () => {
    render(<Composer variant="card" value="" onChange={vi.fn()} onSubmit={vi.fn()} />)
    const root = screen.getByTestId('composer')
    expect(root).toHaveAttribute('data-variant', 'card')
    expect(root.className).toContain('rounded-xl')
    expect(root.className).toContain('border')
  })

  it('flat variant has no rounded card shell', () => {
    render(<Composer variant="flat" value="" onChange={vi.fn()} onSubmit={vi.fn()} />)
    const root = screen.getByTestId('composer')
    expect(root).toHaveAttribute('data-variant', 'flat')
    expect(root.className).not.toContain('rounded-xl')
    // Transparent top border reserves space; accent on focus (no ring, no layout jump)
    expect(root.className).toContain('border-t')
    expect(root.className).toContain('border-transparent')
    expect(root.className).toContain('focus-within:border-t-accent')
    expect(root.className).not.toContain('ring-')
  })

  it('applies fixed textarea height when provided', () => {
    render(
      <Composer variant="flat" textareaHeight={120} value="" onChange={vi.fn()} onSubmit={vi.fn()} />,
    )
    const ta = screen.getByPlaceholderText(/Message hip/)
    expect(ta).toHaveStyle({ height: '120px' })
  })
})
