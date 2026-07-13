import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView } from '@codemirror/view'
import { githubLight, githubDark } from '@uiw/codemirror-theme-github'

export interface DocEditorProps {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
}

const markdownExtensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
  EditorView.theme({
    '&': {
      fontSize: '14px',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      minHeight: 'min(60vh, 480px)',
    },
    '.cm-content': {
      padding: '12px 0',
      caretColor: 'var(--ink)',
    },
    '.cm-focused': {
      outline: 'none',
    },
    '&.cm-editor': {
      borderRadius: '8px',
      border: '1px solid var(--border)',
      backgroundColor: 'var(--surface)',
    },
    '&.cm-editor.cm-focused': {
      boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent)',
      borderColor: 'color-mix(in srgb, var(--accent) 50%, var(--border))',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-subtle)',
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--state-hover)',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--state-hover) 70%, transparent)',
    },
  }),
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

export function DocEditor({ value, onChange, onBlur }: DocEditorProps) {
  const isDark = useIsDark()

  const extensions = useMemo(() => {
    const blurHandler = EditorView.domEventHandlers({
      blur: () => {
        onBlur?.()
        return false
      },
    })
    return [...markdownExtensions, blurHandler]
  }, [onBlur])

  return (
    <div className="max-w-3xl" data-testid="knowledge-doc-editor">
      <CodeMirror
        value={value}
        height="min(60vh, 480px)"
        theme={isDark ? githubDark : githubLight}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightSelectionMatches: false,
          bracketMatching: true,
          autocompletion: false,
        }}
        onChange={onChange}
        className="overflow-hidden rounded-lg text-body"
      />
    </div>
  )
}
