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

  it('shares body measure column with Live/Source', () => {
    render(<InlineDocTitle docId="d1" title="Note" onCommit={() => {}} />)
    expect(screen.getByTestId('knowledge-doc-title').className).toContain(
      'knowledge-doc-measure',
    )
  })

  it('readOnly title also uses text-page', () => {
    render(<InlineDocTitle docId="d1" title="Note" readOnly onCommit={() => {}} />)
    expect(screen.getByTestId('knowledge-doc-title').className).toContain('text-page')
    expect(screen.getByTestId('knowledge-doc-title').className).toContain(
      'knowledge-doc-measure',
    )
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

  it('Enter calls onEnterCommit even when title is empty (restore path)', () => {
    const onCommit = vi.fn()
    const onEnterCommit = vi.fn()
    render(
      <InlineDocTitle
        docId="d1"
        title="Note"
        onCommit={onCommit}
        onEnterCommit={onEnterCommit}
      />,
    )
    const input = screen.getByTestId('knowledge-doc-title') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(onEnterCommit).toHaveBeenCalled()
  })

  it('renders textarea (multi-line wrap) and strips newlines from paste', () => {
    const onCommit = vi.fn()
    render(<InlineDocTitle docId="d1" title="Note" onCommit={onCommit} />)
    const el = screen.getByTestId('knowledge-doc-title')
    expect(el.tagName).toBe('TEXTAREA')
    // 粘贴带换行 → 剔除（标题仅视觉换行，存储保持单行）
    fireEvent.change(el, { target: { value: 'Long\nTitle' } })
    expect(el).toHaveValue('LongTitle')
    fireEvent.keyDown(el, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('LongTitle')
  })

  it('auto-resizes textarea height for long titles (wrap visible)', () => {
    render(<InlineDocTitle docId="d1" title="Note" onCommit={() => {}} />)
    const el = screen.getByTestId('knowledge-doc-title') as HTMLTextAreaElement
    // 模拟长标题换行：行高 32px，三行内容 → 高度 ≥ 2 行高
    Object.defineProperty(el, 'scrollHeight', { value: 96, configurable: true })
    fireEvent.change(el, { target: { value: '超长标题超长标题超长标题超长标题超长标题超长标题超长标题超长标题' } })
    expect(parseInt(el.style.height, 10)).toBeGreaterThan(0)
    expect(el.style.height).toBe('96px')
  })
})
