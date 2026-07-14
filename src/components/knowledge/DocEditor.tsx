import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { keymap, EditorView, type KeyBinding } from '@codemirror/view'
import { Compartment, Prec } from '@codemirror/state'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import {
  headingAndDispatch,
  insertFence,
  insertTextAtCursor,
  prefixAndDispatch,
  wrapAndDispatch,
} from '@/domain/knowledge/mdEdit'
import {
  importAssetFromClipboardItems,
  importAssetFromFile,
} from '@/domain/knowledge/importAsset'

export interface DocEditorProps {
  /** Remount key source — parent should also pass key={docId} */
  docId: string
  initialValue: string
  onDraftChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  /** Optional Cmd/Ctrl+S → flush save (Workspace). */
  onSave?: () => void
  /** Active space for asset paste/drop. */
  spaceId?: string | null
  /** Toast/surface import failures (too large, unsupported). */
  onAssetImportError?: (reason: 'too_large_paste' | 'too_large_disk' | 'unsupported' | 'error') => void
  onAssetImported?: () => void
}

export type DocEditorHandle = {
  getView: () => EditorView | null
}

/** Token-driven CM chrome — no stock light/dark skin (K26). */
function buildProseTheme(isDark: boolean) {
  return EditorView.theme(
    {
      '&': {
        fontSize: '14px',
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
        padding: '4px 2px 96px',
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

function pushDraft(view: EditorView, onDraftChange: (v: string) => void) {
  onDraftChange(view.state.doc.toString())
}

/**
 * Local-text CodeMirror host.
 * Keep `value` in sync with local state only — never echo store `docBody` while typing.
 */
export const DocEditor = forwardRef<DocEditorHandle, DocEditorProps>(function DocEditor(
  {
    docId: _docId,
    initialValue,
    onDraftChange,
    onBlur,
    placeholder,
    onSave,
    spaceId,
    onAssetImportError,
    onAssetImported,
  },
  ref,
) {
  const isDark = useIsDark()
  const [text, setText] = useState(initialValue)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartment = useMemo(() => new Compartment(), [])
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur
  const onDraftChangeRef = useRef(onDraftChange)
  onDraftChangeRef.current = onDraftChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const spaceIdRef = useRef(spaceId)
  spaceIdRef.current = spaceId
  const onAssetImportErrorRef = useRef(onAssetImportError)
  onAssetImportErrorRef.current = onAssetImportError
  const onAssetImportedRef = useRef(onAssetImported)
  onAssetImportedRef.current = onAssetImported

  useImperativeHandle(ref, () => ({
    getView: () => viewRef.current,
  }))

  // Stable extensions; theme swaps via Compartment so keymap/state are not rebuilt.
  const extensions = useMemo(() => {
    const insertMarkdown = (view: EditorView, md: string) => {
      // Prefer surrounding newlines so the image is on its own line when mid-paragraph.
      const pos = view.state.selection.main.from
      const before = pos > 0 ? view.state.sliceDoc(pos - 1, pos) : '\n'
      const after = pos < view.state.doc.length ? view.state.sliceDoc(pos, pos + 1) : '\n'
      let snippet = md
      if (before !== '\n') snippet = `\n${snippet}`
      if (after !== '\n') snippet = `${snippet}\n`
      if (insertTextAtCursor(view, snippet)) {
        pushDraft(view, onDraftChangeRef.current)
        setText(view.state.doc.toString())
        onAssetImportedRef.current?.()
      }
    }

    const handleImportResult = (
      view: EditorView,
      result: Awaited<ReturnType<typeof importAssetFromFile>>,
    ) => {
      if (result.ok) {
        insertMarkdown(view, result.markdown)
        return
      }
      onAssetImportErrorRef.current?.(result.reason)
    }

    const assetHandlers = EditorView.domEventHandlers({
      blur: () => {
        onBlurRef.current?.()
        return false
      },
      paste: (event, view) => {
        const space = spaceIdRef.current
        if (!space || !event.clipboardData) return false
        const items = event.clipboardData.items
        if (!items?.length) return false
        let hasImage = false
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (it.kind === 'file' && it.type.startsWith('image/') && it.type !== 'image/svg+xml') {
            hasImage = true
            break
          }
        }
        if (!hasImage) return false
        event.preventDefault()
        void importAssetFromClipboardItems(space, items).then((result) => {
          if (!result) return
          handleImportResult(view, result)
        })
        return true
      },
      drop: (event, view) => {
        const space = spaceIdRef.current
        if (!space || !event.dataTransfer?.files?.length) return false
        const files = Array.from(event.dataTransfer.files)
        const assets = files.filter((f) => {
          const mime = f.type
          return (
            (mime.startsWith('image/') && mime !== 'image/svg+xml') ||
            mime === 'application/pdf' ||
            /\.(png|jpe?g|gif|webp|pdf)$/i.test(f.name)
          )
        })
        if (!assets.length) return false
        event.preventDefault()
        void (async () => {
          for (const file of assets) {
            const result = await importAssetFromFile(space, file)
            handleImportResult(view, result)
          }
        })()
        return true
      },
    })

    const run =
      (fn: (view: EditorView) => boolean): KeyBinding['run'] =>
      (view) => {
        if (view.composing) return false
        const ok = fn(view)
        if (ok) pushDraft(view, onDraftChangeRef.current)
        return ok
      }

    const knowledgeKeys: KeyBinding[] = [
      {
        key: 'Mod-b',
        run: run((v) => wrapAndDispatch(v, '**')),
      },
      {
        // MVP: single * for italic (see wrapSelection note)
        key: 'Mod-i',
        run: run((v) => wrapAndDispatch(v, '*')),
      },
      {
        key: 'Mod-e',
        run: run((v) => wrapAndDispatch(v, '`')),
      },
      {
        key: 'Mod-Alt-1',
        run: run((v) => headingAndDispatch(v, 1)),
      },
      {
        key: 'Mod-Alt-2',
        run: run((v) => headingAndDispatch(v, 2)),
      },
      {
        key: 'Mod-Alt-3',
        run: run((v) => headingAndDispatch(v, 3)),
      },
      {
        key: 'Mod-Shift-8',
        run: run((v) => prefixAndDispatch(v, '- ')),
      },
      {
        key: 'Mod-Shift-7',
        run: run((v) => prefixAndDispatch(v, '1. ')),
      },
      {
        key: 'Mod-Shift-.',
        run: run((v) => prefixAndDispatch(v, '> ')),
      },
      {
        key: 'Mod-Shift-c',
        run: run((v) => insertFence(v)),
      },
      {
        key: 'Mod-s',
        run: () => {
          onSaveRef.current?.()
          return true
        },
      },
    ]

    return [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      themeCompartment.of(buildProseTheme(false)),
      assetHandlers,
      highlightSelectionMatches(),
      Prec.highest(keymap.of([...knowledgeKeys, ...searchKeymap])),
    ]
  }, [themeCompartment])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: themeCompartment.reconfigure(buildProseTheme(isDark)),
    })
  }, [isDark, themeCompartment])

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
          highlightActiveLine: false,
          highlightSelectionMatches: false,
          bracketMatching: true,
          autocompletion: false,
        }}
        placeholder={placeholder}
        autoFocus
        onCreateEditor={(view) => {
          viewRef.current = view
          view.dispatch({
            effects: themeCompartment.reconfigure(buildProseTheme(isDark)),
          })
        }}
        onChange={(v) => {
          setText(v)
          onDraftChangeRef.current(v)
        }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden text-prose [&_.cm-editor]:h-full"
      />
    </div>
  )
})
