import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView } from '@codemirror/view'

export interface DocEditorProps {
  /** Remount key source — parent should also pass key={docId} */
  docId: string
  initialValue: string
  onDraftChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
}

const proseTheme = EditorView.theme({
  '&': {
    fontSize: '15px',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    lineHeight: '1.7',
    height: '100%',
  },
  '.cm-content': {
    padding: '16px 20px 48px',
    caretColor: 'var(--ink)',
    minHeight: '100%',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '&.cm-editor': {
    height: '100%',
    backgroundColor: 'transparent',
  },
  '&.cm-editor.cm-focused': {
    outline: 'none',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--state-hover) 50%, transparent)',
  },
  '.cm-placeholder': {
    color: 'var(--text-tertiary)',
    fontStyle: 'normal',
  },
})

const markdownExtensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
  proseTheme,
]

function useIsDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false,
  )

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  return dark
}

/**
 * Local-text CodeMirror host.
 * Keep `value` in sync with local state only — never echo store `docBody` while typing,
 * or @uiw/react-codemirror will forceUpdate after its 200ms typing latch and wipe draft.
 * Parent remounts via key={docId} (and when toggling preview↔edit) to re-seed.
 */
export function DocEditor({
  docId: _docId,
  initialValue,
  onDraftChange,
  onBlur,
  placeholder,
}: DocEditorProps) {
  const isDark = useIsDark()
  const [text, setText] = useState(initialValue)
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur
  const onDraftChangeRef = useRef(onDraftChange)
  onDraftChangeRef.current = onDraftChange

  const extensions = useMemo(() => {
    const blurHandler = EditorView.domEventHandlers({
      blur: () => {
        onBlurRef.current?.()
        return false
      },
    })
    return [...markdownExtensions, blurHandler]
  }, [])

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col"
      data-testid="knowledge-doc-editor"
    >
      <CodeMirror
        value={text}
        height="100%"
        theme={isDark ? 'dark' : 'light'}
        extensions={extensions}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: true,
          highlightSelectionMatches: false,
          bracketMatching: true,
          autocompletion: false,
        }}
        placeholder={placeholder}
        autoFocus
        onChange={(v) => {
          setText(v)
          onDraftChangeRef.current(v)
        }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden text-body [&_.cm-editor]:h-full"
      />
    </div>
  )
}
