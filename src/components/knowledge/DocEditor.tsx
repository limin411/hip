import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { useTranslation } from 'react-i18next'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { keymap, EditorView, type KeyBinding } from '@codemirror/view'
import { Compartment, EditorSelection, Prec } from '@codemirror/state'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import {
  applySlashInsert,
  headingAndDispatch,
  insertFence,
  insertTextAtCursor,
  prefixAndDispatch,
  wrapAndDispatch,
} from '@/domain/knowledge/mdEdit'
import {
  extractSlashQueryAt,
  prepareSlashInsert,
  sameSlashMatch,
  type KnowledgeSlashItem,
  type SlashQueryMatch,
} from '@/domain/knowledge/slashMenu'
import { KnowledgeSlashMenu } from './KnowledgeSlashMenu'
import {
  importAssetFromClipboardItems,
  importAssetFromFile,
} from '@/domain/knowledge/importAsset'
import { wikiLinkAutocomplete } from '@/domain/knowledge/wikiCmCompletion'
import { typoraLivePreview } from '@/domain/knowledge/typoraPreview'
import { resolveAssetDataUrl } from '@/domain/knowledge/assetUrl'
import { splitYamlFrontmatter } from '@/domain/knowledge/frontmatter'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { kbPerfSourceReady } from '@/domain/knowledge/knowledgePerf'
import './knowledge-typora.css'

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
  /** Slash `/image` opens the OS attach picker (same as Live; K10). */
  onRequestAttach?: () => void
  /** Current space nodes for `[[` wiki title completion (same space). */
  wikiNodes?: KnowledgeNode[]
}

export type DocEditorHandle = {
  getView: () => EditorView | null
  focus: () => boolean
}

/** Token-driven CM chrome — shared `--kb-*` with Live (P0.1). */
function buildProseTheme(isDark: boolean) {
  return EditorView.theme(
    {
      '&': {
        fontSize: 'var(--kb-font-body, 15px)',
        height: '100%',
        color: 'var(--text-primary)',
        backgroundColor: 'transparent',
      },
      '.cm-scroller': {
        fontFamily: 'var(--kb-font-family, ui-sans-serif, system-ui, sans-serif)',
        lineHeight: 'var(--kb-line-body, 1.7)',
        height: '100%',
      },
      '.cm-content': {
        padding: '4px 2px var(--kb-pad-bottom, 8rem)',
        caretColor: 'var(--text-primary)',
        minHeight: '100%',
        color: 'var(--text-primary)',
        maxWidth: 'var(--kb-measure, 46rem)',
        marginInline: 'auto',
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
        backgroundColor:
          'var(--kb-selection, color-mix(in srgb, var(--accent) 22%, transparent)) !important',
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
function readSlashMatch(view: EditorView): SlashQueryMatch | null {
  const head = view.state.selection.main.head
  if (!view.state.selection.main.empty) return null
  const line = view.state.doc.lineAt(head)
  return extractSlashQueryAt(line.text, head - line.from, line.from)
}

type MenuPos = { top: number; left: number; width: number; maxHeight: number }

/** Menu width used for clamping caret-relative left. */
const SLASH_MENU_WIDTH = 320
const SLASH_MENU_MAX_H = 224

function computeMenuPos(view: EditorView, match: SlashQueryMatch): MenuPos {
  const fallback: MenuPos = {
    top: 8,
    left: 8,
    width: SLASH_MENU_WIDTH,
    maxHeight: SLASH_MENU_MAX_H,
  }
  const coords = view.coordsAtPos(match.from)
  const root = view.dom.closest(
    '[data-testid="knowledge-doc-editor"]',
  ) as HTMLElement | null
  if (!coords || !root) return fallback
  const rootRect = root.getBoundingClientRect()
  const spaceBelow = rootRect.bottom - coords.bottom
  const preferAbove = spaceBelow < SLASH_MENU_MAX_H + 12
  const top = preferAbove
    ? Math.max(8, coords.top - rootRect.top - SLASH_MENU_MAX_H - 4)
    : coords.bottom - rootRect.top + 4
  const rawLeft = coords.left - rootRect.left
  const left = Math.max(
    8,
    Math.min(rawLeft, Math.max(8, rootRect.width - SLASH_MENU_WIDTH - 8)),
  )
  const maxHeight = preferAbove
    ? Math.min(SLASH_MENU_MAX_H, Math.max(80, coords.top - rootRect.top - 8))
    : Math.min(SLASH_MENU_MAX_H, Math.max(80, rootRect.bottom - coords.bottom - 8))
  return { top, left, width: SLASH_MENU_WIDTH, maxHeight }
}

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
    onRequestAttach,
    wikiNodes,
  },
  ref,
) {
  const isDark = useIsDark()
  const { t } = useTranslation()
  const [text, setText] = useState(initialValue)
  const [slashMatch, setSlashMatch] = useState<SlashQueryMatch | null>(null)
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const themeCompartment = useMemo(() => new Compartment(), [])
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur
  const onDraftChangeRef = useRef(onDraftChange)
  onDraftChangeRef.current = onDraftChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  /**
   * Last draft string we already pushed (I2 / R1).
   * Prefer equality over a sticky boolean: if onChange never echoes, the next
   * real edit still notifies (value ≠ lastPushed). Cleared when onChange matches.
   */
  const lastPushedDraftRef = useRef<string | null>(null)
  const slashMatchRef = useRef<SlashQueryMatch | null>(null)
  slashMatchRef.current = slashMatch

  const pushDraftOnce = useCallback((next: string) => {
    lastPushedDraftRef.current = next
    setText(next)
    onDraftChangeRef.current(next)
  }, [])

  const updateSlashMatch = useCallback((next: SlashQueryMatch | null) => {
    setSlashMatch((prev) => (sameSlashMatch(prev, next) ? prev : next))
  }, [])
  const spaceIdRef = useRef(spaceId)
  spaceIdRef.current = spaceId
  const onAssetImportErrorRef = useRef(onAssetImportError)
  onAssetImportErrorRef.current = onAssetImportError
  const onAssetImportedRef = useRef(onAssetImported)
  onAssetImportedRef.current = onAssetImported
  const onRequestAttachRef = useRef(onRequestAttach)
  onRequestAttachRef.current = onRequestAttach
  const wikiNodesRef = useRef(wikiNodes ?? [])
  wikiNodesRef.current = wikiNodes ?? []

  useImperativeHandle(ref, () => ({
    getView: () => viewRef.current,
    focus: () => {
      const view = viewRef.current
      if (!view) return false
      view.focus()
      return true
    },
  }))

  // Stable extensions; theme swaps via Compartment so keymap/state are not rebuilt.
  // Wiki nodes are read via ref so the completion source stays fresh without rebuild.
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
        // Delay so menu item mousedown can run first.
        window.setTimeout(() => updateSlashMatch(null), 0)
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

    const slashTracker = EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.selectionSet) return
      // IME: do not open/update slash menu while composing
      if (update.view.composing) {
        updateSlashMatch(null)
        return
      }
      updateSlashMatch(readSlashMatch(update.view))
    })

    // Status bar: cursor line/col (selection or caret head).
    const cursorTracker = EditorView.updateListener.of((update) => {
      if (!update.selectionSet && !update.docChanged) return
      const head = update.state?.selection?.main?.head
      if (typeof head !== 'number') return
      try {
        const line = update.state!.doc.lineAt(head)
        setCursor({ line: line.number, col: head - line.from + 1 })
      } catch {
        // ignore — doc may be mid-transaction in tests
      }
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
      slashTracker,
      cursorTracker,
      assetHandlers,
      highlightSelectionMatches(),
      wikiLinkAutocomplete(() => wikiNodesRef.current),
      // Typora-style live preview: markdown renders in place, raw syntax
      // reveals under the caret. Visual only — doc text stays raw markdown.
      typoraLivePreview({
        resolveAsset: (src) => {
          const spaceId = spaceIdRef.current
          if (!spaceId) return null
          return resolveAssetDataUrl(spaceId, src).then((res) => res?.dataUrl ?? null)
        },
      }),
      Prec.highest(keymap.of([...knowledgeKeys, ...searchKeymap])),
    ]
  }, [themeCompartment, updateSlashMatch])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: themeCompartment.reconfigure(buildProseTheme(isDark)),
    })
  }, [isDark, themeCompartment])

  // M2 + R2: caret-relative menu; refresh on scroll/resize while open.
  useEffect(() => {
    if (!slashMatch) {
      setMenuPos(null)
      return
    }
    const view = viewRef.current
    if (!view) {
      setMenuPos({
        top: 8,
        left: 8,
        width: SLASH_MENU_WIDTH,
        maxHeight: SLASH_MENU_MAX_H,
      })
      return
    }

    // Synchronous first paint so the menu is not delayed one frame (tests + open).
    setMenuPos(computeMenuPos(view, slashMatch))

    let raf = 0
    const onScrollOrResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setMenuPos(computeMenuPos(view, slashMatch))
      })
    }

    const scrollDOM = view.scrollDOM
    scrollDOM.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      cancelAnimationFrame(raf)
      scrollDOM.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [slashMatch])

  /** Status-bar derived values (Source). */
  const { fmOn, wordCount } = useMemo(() => {
    const { fmText, body } = splitYamlFrontmatter(text)
    const words = body.trim().match(/\S+/g)?.length ?? 0
    return { fmOn: fmText !== '', wordCount: words }
  }, [text])

  const onSlashSelect = useCallback(
    (item: KnowledgeSlashItem) => {
      const view = viewRef.current
      const match = slashMatchRef.current
      if (!view || !match || view.composing) return
      // Slash `/image` opens the OS attach picker (same as Live). CodeMirror has
      // no native suggestion host, so consume the `/trigger` text before opening.
      if (item.id === 'image' && onRequestAttachRef.current) {
        applySlashInsert(view, match.from, match.to, '', 0)
        pushDraftOnce(view.state.doc.toString())
        updateSlashMatch(null)
        view.focus()
        window.setTimeout(() => onRequestAttachRef.current?.(), 0)
        return
      }
      const prepared = prepareSlashInsert(view.state.doc.toString(), match.from, item)
      if (
        applySlashInsert(
          view,
          match.from,
          match.to,
          prepared.insert,
          prepared.cursorOffset,
        )
      ) {
        // I2/R1: push draft once via equality-based suppress of onChange echo.
        pushDraftOnce(view.state.doc.toString())
        updateSlashMatch(null)
        view.focus()
      }
    },
    [pushDraftOnce, updateSlashMatch],
  )

  /** L2: Escape strips `/query` (align with chat dismiss), then hide menu. */
  const onSlashDismiss = useCallback(() => {
    const view = viewRef.current
    const match = slashMatchRef.current
    if (view && match && !view.composing) {
      view.dispatch({
        changes: { from: match.from, to: match.to, insert: '' },
        selection: EditorSelection.cursor(match.from),
      })
      pushDraftOnce(view.state.doc.toString())
    }
    updateSlashMatch(null)
    view?.focus()
  }, [pushDraftOnce, updateSlashMatch])

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 w-full flex-1 flex-col"
      data-testid="knowledge-doc-editor"
    >
      {slashMatch && menuPos ? (
        <KnowledgeSlashMenu
          query={slashMatch.query}
          onSelect={onSlashSelect}
          onDismiss={onSlashDismiss}
          className="absolute"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            maxHeight: menuPos.maxHeight,
          }}
        />
      ) : null}
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
          // Wiki picker uses wikiLinkAutocomplete extension; keep default off to avoid double UI.
          autocompletion: false,
        }}
        placeholder={placeholder}
        autoFocus
        onCreateEditor={(view) => {
          viewRef.current = view
          view.dispatch({
            effects: themeCompartment.reconfigure(buildProseTheme(isDark)),
          })
          updateSlashMatch(readSlashMatch(view))
          kbPerfSourceReady()
        }}
        onChange={(v) => {
          setText(v)
          // R1: skip only the echo of a value we already pushed; never sticky-drop.
          if (lastPushedDraftRef.current === v) {
            lastPushedDraftRef.current = null
            return
          }
          lastPushedDraftRef.current = null
          onDraftChangeRef.current(v)
        }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden text-prose [&_.cm-editor]:h-full"
      />
      <footer
        className="knowledge-doc-measure flex shrink-0 items-center justify-end gap-3 border-t border-border/70 px-3 py-1 text-meta text-ink-tertiary"
        data-testid="knowledge-source-statusbar"
      >
        {fmOn ? (
          <span
            data-testid="kb-status-fm"
            title={t('knowledge.doc.statusBar.fmTitle')}
          >
            FM
          </span>
        ) : null}
        <span data-testid="kb-status-words">
          {t('knowledge.doc.statusBar.words', { count: wordCount })}
        </span>
        <span data-testid="kb-status-cursor">
          {t('knowledge.doc.statusBar.lineCol', {
            line: cursor?.line ?? 1,
            col: cursor?.col ?? 1,
          })}
        </span>
      </footer>
    </div>
  )
})
