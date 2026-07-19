// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { InlineDocTitle } from './InlineDocTitle'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'knowledge.doc.titleLabel': 'Document title',
        'knowledge.doc.untitled': 'Untitled',
      }
      return map[key] ?? key
    },
  }),
}))

afterEach(() => cleanup())

describe('InlineDocTitle', () => {
  it('renders title and commits on blur when changed', () => {
    const onCommit = vi.fn()
    render(<InlineDocTitle docId="d1" title="Note" onCommit={onCommit} />)
    const input = screen.getByTestId('knowledge-doc-title') as HTMLInputElement
    expect(input).toHaveValue('Note')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith('Renamed')
  })

  it('uses text-page for document page H1 scale', () => {
    render(<InlineDocTitle docId="d1" title="Note" onCommit={() => {}} />)
    expect(screen.getByTestId('knowledge-doc-title').className).toContain('text-page')
  })

  it('readOnly title also uses text-page', () => {
    render(<InlineDocTitle docId="d1" title="Note" readOnly onCommit={() => {}} />)
    expect(screen.getByTestId('knowledge-doc-title').className).toContain('text-page')
  })

  it('does not commit empty title; restores previous', () => {
    const onCommit = vi.fn()
    render(<InlineDocTitle docId="d1" title="Note" onCommit={onCommit} />)
    const input = screen.getByTestId('knowledge-doc-title') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(input).toHaveValue('Note')
  })

  it('readOnly renders heading without input', () => {
    render(<InlineDocTitle docId="d1" title="Note" readOnly onCommit={() => {}} />)
    const el = screen.getByTestId('knowledge-doc-title')
    expect(el.tagName).toBe('H1')
    expect(el).toHaveTextContent('Note')
  })

  it('Enter commits via blur', () => {
    const onCommit = vi.fn()
    render(<InlineDocTitle docId="d1" title="Note" onCommit={onCommit} />)
    const input = screen.getByTestId('knowledge-doc-title') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Enter title' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('Enter title')
  })
})
