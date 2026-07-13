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

/** Token-driven CM chrome — no stock light/dark skin (K26). */
function buildProseTheme(isDark: boolean) {
  return EditorView.theme(
    {
      '&': {
        fontSize: '14px', // matches tailwind `prose`
        height: '100%',
        color: 'var(--text-primary)',
        backgroundColor: 'transparent',
      },
      '.cm-scroller': {
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        lineHeight: '1.7',
        height: '100%',
      },
      '.cm-content': {
        padding: '20px 4px 64px',
        caretColor: 'var(--text-primary)',
        minHeight: '100%',
        color: 'var(--text-primary)',
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
        backgroundColor: 'color-mix(in srgb, var(--state-hover) 55%, transparent)',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--text-primary)',
      },
      '.cm-placeholder': {
        color: 'var(--text-tertiary)',
        fontStyle: 'normal',
      },
      // Keep syntax marks readable but monochrome-friendly
      '.cm-header': {
        color: 'var(--text-primary)',
        fontWeight: '600',
      },
      '.cm-link': {
        color: 'var(--accent-strong)',
      },
      '.cm-url': {
        color: 'var(--text-secondary)',
      },
      '.cm-meta, .cm-comment': {
        color: 'var(--text-tertiary)',
      },
      '.cm-string, .cm-quote': {
        color: 'var(--text-secondary)',
      },
      '.cm-keyword, .cm-operator': {
        color: 'var(--accent-strong)',
      },
    },
    { dark: isDark },
  )
}

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
    return [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      buildProseTheme(isDark),
      blurHandler,
    ]
  }, [isDark])

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col"
      data-testid="knowledge-doc-editor"
    >
      <CodeMirror
        value={text}
        height="100%"
        theme="none"
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
        className="flex min-h-0 flex-1 flex-col overflow-hidden text-prose [&_.cm-editor]:h-full"
      />
    </div>
  )
}
