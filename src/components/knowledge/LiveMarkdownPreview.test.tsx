// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { LiveMarkdownPreview } from './LiveMarkdownPreview'

vi.mock('./DocReader', () => ({
  DocReader: ({ content }: { content: string }) => (
    <div data-testid="mock-reader">{content}</div>
  ),
}))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('LiveMarkdownPreview', () => {
  it('debounces body updates before rendering', () => {
    const { rerender } = render(<LiveMarkdownPreview body="one" />)
    expect(screen.getByTestId('mock-reader')).toHaveTextContent('one')

    rerender(<LiveMarkdownPreview body="two" />)
    // still old until debounce fires
    expect(screen.getByTestId('mock-reader')).toHaveTextContent('one')

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByTestId('mock-reader')).toHaveTextContent('two')
  })
})
