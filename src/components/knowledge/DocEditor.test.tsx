// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DocEditor } from './DocEditor'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange?: (v: string) => void
    placeholder?: string
  }) => (
    <textarea
      data-testid="knowledge-doc-editor-cm"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => ({}),
  markdownLanguage: {},
}))

vi.mock('@codemirror/language-data', () => ({
  languages: [],
}))

vi.mock('@codemirror/view', () => ({
  EditorView: {
    lineWrapping: {},
    theme: (_styles?: unknown, _opts?: unknown) => ({}),
    domEventHandlers: () => ({}),
  },
  keymap: { of: () => ({}) },
}))

vi.mock('@codemirror/state', () => ({
  Prec: { highest: (x: unknown) => x },
}))

vi.mock('@codemirror/search', () => ({
  searchKeymap: [],
  highlightSelectionMatches: () => ({}),
}))

vi.mock('@/domain/knowledge/mdEdit', () => ({
  headingAndDispatch: () => true,
  insertFence: () => true,
  prefixAndDispatch: () => true,
  wrapAndDispatch: () => true,
}))

afterEach(() => cleanup())

describe('DocEditor', () => {
  it('renders the CodeMirror host with knowledge editor testid', () => {
    render(
      <DocEditor
        docId="d1"
        initialValue="# hi"
        onDraftChange={() => {}}
        placeholder="Start writing…"
      />,
    )
    expect(screen.getByTestId('knowledge-doc-editor')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-doc-editor-cm')).toHaveValue('# hi')
    expect(screen.getByTestId('knowledge-doc-editor-cm')).toHaveAttribute(
      'placeholder',
      'Start writing…',
    )
  })

  it('forwards onDraftChange from the editor', () => {
    const onDraftChange = vi.fn()
    render(<DocEditor docId="d1" initialValue="" onDraftChange={onDraftChange} />)
    fireEvent.change(screen.getByTestId('knowledge-doc-editor-cm'), {
      target: { value: 'hello' },
    })
    expect(onDraftChange).toHaveBeenCalledWith('hello')
  })
})
