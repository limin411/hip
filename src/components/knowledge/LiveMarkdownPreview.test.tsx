// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { LiveMarkdownPreview } from './LiveMarkdownPreview'
import { useKnowledgeStore } from '@/store/knowledgeStore'

vi.mock('./DocReader', () => ({
  DocReader: ({ content }: { content: string }) => (
    <div data-testid="mock-reader">{content}</div>
  ),
}))

beforeEach(() => {
  vi.useFakeTimers()
  useKnowledgeStore.setState({ draftBody: 'one' })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useKnowledgeStore.setState({ draftBody: '' })
})

describe('LiveMarkdownPreview', () => {
  it('debounces draftBody updates before rendering', () => {
    render(<LiveMarkdownPreview />)
    expect(screen.getByTestId('mock-reader')).toHaveTextContent('one')

    act(() => {
      useKnowledgeStore.setState({ draftBody: 'two' })
    })
    // still old until debounce fires
    expect(screen.getByTestId('mock-reader')).toHaveTextContent('one')

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByTestId('mock-reader')).toHaveTextContent('two')
  })

  it('resets to an empty body without stale content', () => {
    render(<LiveMarkdownPreview />)
    act(() => {
      useKnowledgeStore.setState({ draftBody: '' })
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByTestId('mock-reader')).toBeEmptyDOMElement()
  })
})
