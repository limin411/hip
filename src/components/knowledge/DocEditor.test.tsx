// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DocEditor } from './DocEditor'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange?: (v: string) => void
  }) => (
    <textarea
      data-testid="knowledge-doc-editor-cm"
      value={value}
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
    theme: () => ({}),
    domEventHandlers: () => ({}),
  },
}))

vi.mock('@uiw/codemirror-theme-github', () => ({
  githubLight: {},
  githubDark: {},
}))

afterEach(() => cleanup())

describe('DocEditor', () => {
  it('renders the CodeMirror host with knowledge editor testid', () => {
    render(<DocEditor value="# hi" onChange={() => {}} />)
    expect(screen.getByTestId('knowledge-doc-editor')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-doc-editor-cm')).toHaveValue('# hi')
  })

  it('forwards onChange from the editor', () => {
    const onChange = vi.fn()
    render(<DocEditor value="" onChange={onChange} />)
    fireEvent.change(screen.getByTestId('knowledge-doc-editor-cm'), {
      target: { value: 'hello' },
    })
    expect(onChange).toHaveBeenCalledWith('hello')
  })
})
