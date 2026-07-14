// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { DocEditor } from './DocEditor'
import { prepareSlashInsert } from '@/domain/knowledge/slashMenu'

const applySlashInsert = vi.fn(
  (
    _view: unknown,
    _from: number,
    _to: number,
    _insert: string,
    _cursorOffset: number,
  ): boolean => true,
)

/** Captured CM updateListener callback (L4 bridge). */
let updateListenerCb: ((update: {
  docChanged: boolean
  selectionSet: boolean
  view: unknown
}) => void) | null = null

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    onChange,
    placeholder,
    onCreateEditor,
  }: {
    value: string
    onChange?: (v: string) => void
    placeholder?: string
    onCreateEditor?: (view: unknown) => void
  }) => (
    <textarea
      data-testid="knowledge-doc-editor-cm"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      ref={() => {
        // Minimal fake view for onCreateEditor / slash tracker
        const view = makeFakeView(value)
        onCreateEditor?.(view)
      }}
    />
  ),
}))

function makeFakeView(doc: string, head = doc.length) {
  const scrollDOM = document.createElement('div')
  return {
    composing: false,
    focus: vi.fn(),
    coordsAtPos: () => ({ top: 40, bottom: 56, left: 24, right: 40 }),
    scrollDOM,
    dom: {
      closest: () => {
        const el = document.querySelector(
          '[data-testid="knowledge-doc-editor"]',
        ) as HTMLElement | null
        if (el) {
          el.getBoundingClientRect = () =>
            ({
              top: 0,
              left: 0,
              bottom: 400,
              right: 600,
              width: 600,
              height: 400,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            }) as DOMRect
        }
        return el
      },
    },
    state: {
      selection: { main: { head, empty: true } },
      doc: {
        toString: () => doc,
        lineAt: (pos: number) => {
          const lineStart = doc.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
          const lineEnd = doc.indexOf('\n', pos)
          const end = lineEnd < 0 ? doc.length : lineEnd
          return {
            text: doc.slice(lineStart, end),
            from: lineStart,
          }
        },
      },
    },
    dispatch: vi.fn(),
  }
}

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
    updateListener: {
      of: (fn: typeof updateListenerCb) => {
        updateListenerCb = fn
        return {}
      },
    },
  },
  keymap: { of: () => ({}) },
}))

vi.mock('@codemirror/state', () => ({
  Prec: { highest: (x: unknown) => x },
  EditorSelection: {
    cursor: (n: number) => ({ anchor: n, head: n }),
  },
  Compartment: class {
    of(v: unknown) {
      return v
    }
    reconfigure(v: unknown) {
      return v
    }
  },
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
  applySlashInsert: (
    view: unknown,
    from: number,
    to: number,
    insert: string,
    cursorOffset: number,
  ) => applySlashInsert(view, from, to, insert, cursorOffset),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

afterEach(() => {
  cleanup()
  updateListenerCb = null
  applySlashInsert.mockClear()
})

beforeEach(() => {
  applySlashInsert.mockImplementation(() => true)
})

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

  it('opens slash menu when updateListener reports a / query (L4)', () => {
    render(<DocEditor docId="d1" initialValue="/" onDraftChange={() => {}} />)
    expect(updateListenerCb).toBeTypeOf('function')
    const view = makeFakeView('/', 1)
    act(() => {
      updateListenerCb?.({
        docChanged: true,
        selectionSet: false,
        view,
      })
    })
    expect(screen.getByTestId('knowledge-slash-menu')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-h1')).toBeInTheDocument()
  })

  it('select applies prepared insert range and notifies draft once (L4/I2)', () => {
    const onDraftChange = vi.fn()
    // onCreateEditor builds the viewRef used by onSlashSelect
    render(<DocEditor docId="d1" initialValue="/h1" onDraftChange={onDraftChange} />)
    const trackerView = makeFakeView('/h1', 3)
    applySlashInsert.mockImplementation((v: unknown) => {
      const view = v as { state: { doc: { toString: () => string } } }
      Object.assign(view.state.doc, { toString: () => '# ' })
      return true
    })
    act(() => {
      updateListenerCb?.({
        docChanged: true,
        selectionSet: true,
        view: trackerView,
      })
    })
    expect(screen.getByTestId('knowledge-slash-menu')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('knowledge-slash-h1'))
    const prepared = prepareSlashInsert('/h1', 0, {
      id: 'h1',
      insert: '# ',
      cursorOffset: 2,
    })
    expect(applySlashInsert).toHaveBeenCalledTimes(1)
    const args = applySlashInsert.mock.calls[0]!
    // from/to of `/h1` at line start; prepared snippet (no leading newline)
    expect(args[1]).toBe(0)
    expect(args[2]).toBe(3)
    expect(args[3]).toBe(prepared.insert)
    expect(args[4]).toBe(prepared.cursorOffset)
    expect(onDraftChange).toHaveBeenCalledWith('# ')
    expect(screen.queryByTestId('knowledge-slash-menu')).not.toBeInTheDocument()
  })
})
