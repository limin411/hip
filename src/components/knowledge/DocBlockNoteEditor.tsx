/**
 * Live document editor on BlockNote (TipTap/ProseMirror).
 * Notion-class block UX (slash, side menu drag, bubble toolbar).
 * Storage: Markdown + YAML frontmatter (lossy MD round-trip — product-accepted).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { MantineProvider } from '@mantine/core'
import {
  joinYamlFrontmatter,
  splitYamlFrontmatter,
} from '@/domain/knowledge/frontmatter'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import {
  importAssetFromClipboardItems,
  importAssetFromFile,
} from '@/domain/knowledge/importAsset'
import { resolveAssetDataUrl } from '@/domain/knowledge/assetUrl'
import {
  isKnowledgePerfEnabled,
  kbPerfLiveCreateEnd,
  kbPerfLiveCreateStart,
  kbPerfSerialize,
} from '@/domain/knowledge/knowledgePerf'

import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import '@mantine/core/styles.css'
import './knowledge-blocknote.css'

/** Same handle surface as legacy DocLiveEditor (Workspace / attach paths). */
export type DocLiveEditorHandle = {
  insertMarkdown: (md: string) => boolean
  focus: (opts?: { at?: 'start' | 'end' }) => boolean
  flushDraft: () => void
}

export type DocBlockNoteEditorHandle = DocLiveEditorHandle

export interface DocBlockNoteEditorProps {
  docId: string
  initialMarkdown: string
  onDraftChange: (v: string, meta: { docId: string }) => void
  onBlur?: () => void
  onSave?: () => void
  onParseError?: (err: unknown) => void
  placeholder?: string
  wikiNodes?: KnowledgeNode[]
  spaceId?: string | null
  onAssetImportError?: (
    reason: 'too_large_paste' | 'too_large_disk' | 'unsupported' | 'error',
  ) => void
  onAssetImported?: () => void
  onRequestAttach?: () => void
  onWikiNavigate?: (payload: {
    title: string
    nodeId: string | null
    broken: boolean
  }) => void
}

const DRAFT_THROTTLE_MS = 120

/**
 * TipTap EditorContent.componentWillUnmount calls `view.setProps({ nodeViews: {} })`,
 * which re-enters ProseMirror update/iterDeco. With BlockNote decorations that can throw
 * (`deco.locals` / localsInner) and surface as an uncaught error on Live unmount
 * (doc switch, Live→Source, StrictMode). Guard setProps/destroy for this view only.
 */
function hardenTiptapViewTeardown(editor: {
  _tiptapEditor?: {
    isDestroyed?: boolean
    view?: {
      isDestroyed?: boolean
      setProps: (props: Record<string, unknown>) => void
      destroy: () => void
    }
  }
}): () => void {
  const tt = editor._tiptapEditor
  const view = tt?.view
  if (!tt || !view) return () => {}

  const origSetProps = view.setProps.bind(view)
  const origDestroy = view.destroy.bind(view)

  view.setProps = (props: Record<string, unknown>) => {
    try {
      if (tt.isDestroyed || view.isDestroyed) return
      return origSetProps(props)
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[DocBlockNoteEditor] suppressed setProps during teardown', err)
      }
    }
  }

  view.destroy = () => {
    try {
      if (view.isDestroyed) return
      origDestroy()
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[DocBlockNoteEditor] suppressed destroy error', err)
      }
    }
  }

  return () => {
    view.setProps = origSetProps
    view.destroy = origDestroy
  }
}

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false
    return (
      document.documentElement.classList.contains('dark') ||
      document.documentElement.dataset.theme === 'dark' ||
      document.body.dataset.theme === 'dark'
    )
  })
  useEffect(() => {
    const root = document.documentElement
    const sync = () => {
      setDark(
        root.classList.contains('dark') ||
          root.dataset.theme === 'dark' ||
          document.body.dataset.theme === 'dark',
      )
    }
    const mo = new MutationObserver(sync)
    mo.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return dark
}

export const DocBlockNoteEditor = forwardRef<
  DocBlockNoteEditorHandle,
  DocBlockNoteEditorProps
>(function DocBlockNoteEditor(
  {
    docId,
    initialMarkdown,
    onDraftChange,
    onBlur,
    onSave,
    onParseError,
    placeholder,
    spaceId,
    onAssetImportError,
    onAssetImported,
  },
  ref,
) {
  const boundDocIdRef = useRef(docId)
  boundDocIdRef.current = docId
  const fmTextRef = useRef('')
  const onDraftChangeRef = useRef(onDraftChange)
  onDraftChangeRef.current = onDraftChange
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onParseErrorRef = useRef(onParseError)
  onParseErrorRef.current = onParseError
  const spaceIdRef = useRef(spaceId)
  spaceIdRef.current = spaceId
  const onAssetImportErrorRef = useRef(onAssetImportError)
  onAssetImportErrorRef.current = onAssetImportError
  const onAssetImportedRef = useRef(onAssetImported)
  onAssetImportedRef.current = onAssetImported

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftDirtyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const skipNextChangeRef = useRef(true)
  const isDark = usePrefersDark()

  const { fmText, body } = useMemo(
    () => splitYamlFrontmatter(initialMarkdown),
    // Parent remounts via key={docId}; seed once per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId],
  )
  fmTextRef.current = fmText

  const editor = useCreateBlockNote(
    {
      placeholders: {
        default: placeholder ?? "Type '/' for commands",
      },
      uploadFile: async (file: File) => {
        const sid = spaceIdRef.current
        if (!sid) throw new Error('no space')
        const res = await importAssetFromFile(sid, file)
        if (!res.ok) {
          onAssetImportErrorRef.current?.(
            res.reason === 'too_large_paste'
              ? 'too_large_paste'
              : res.reason === 'too_large_disk'
                ? 'too_large_disk'
                : res.reason === 'unsupported'
                  ? 'unsupported'
                  : 'error',
          )
          throw new Error(res.reason)
        }
        onAssetImportedRef.current?.()
        // Persist relative path in document; resolveFileUrl expands for display.
        return res.meta.relPath
      },
      resolveFileUrl: async (url: string) => {
        const sid = spaceIdRef.current
        if (!sid) return url
        if (
          url.startsWith('data:') ||
          url.startsWith('http://') ||
          url.startsWith('https://') ||
          url.startsWith('blob:')
        ) {
          return url
        }
        const resolved = await resolveAssetDataUrl(sid, url)
        return resolved?.dataUrl ?? url
      },
    },
    [docId],
  )

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    // BlockNoteView may mount the PM view one frame after editor create.
    let restore = hardenTiptapViewTeardown(editor)
    const rebind = () => {
      restore()
      restore = hardenTiptapViewTeardown(editor)
    }
    const raf = requestAnimationFrame(rebind)
    const tt = editor._tiptapEditor as
      | { on?: (e: string, cb: () => void) => void; off?: (e: string, cb: () => void) => void }
      | undefined
    tt?.on?.('mount', rebind)
    return () => {
      aliveRef.current = false
      cancelAnimationFrame(raf)
      tt?.off?.('mount', rebind)
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current)
        draftTimerRef.current = null
      }
      // Best-effort draft flush before view is gone (child unmount runs first).
      try {
        if (draftDirtyRef.current) {
          draftDirtyRef.current = false
          const bodyMd = editor.blocksToMarkdownLossy(editor.document)
          onDraftChangeRef.current(
            joinYamlFrontmatter(fmTextRef.current, bodyMd),
            { docId: boundDocIdRef.current },
          )
        }
      } catch {
        // editor already torn down
      }
      // Do not call editor.unmount() — BlockNoteView owns mount/unmount.
      restore()
    }
  }, [editor])

  // Initial markdown → blocks
  useEffect(() => {
    kbPerfLiveCreateStart()
    try {
      skipNextChangeRef.current = true
      const blocks = editor.tryParseMarkdownToBlocks(body || '')
      const ids = editor.document.map((b) => b.id)
      if (blocks.length > 0) {
        editor.replaceBlocks(ids, blocks)
      }
      kbPerfLiveCreateEnd()
    } catch (err) {
      onParseErrorRef.current?.(err)
    }
    const t = window.setTimeout(() => {
      skipNextChangeRef.current = false
    }, 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const emitDraft = useCallback(() => {
    draftDirtyRef.current = false
    if (!aliveRef.current) return
    try {
      if (editor._tiptapEditor?.isDestroyed) return
      const t0 = isKnowledgePerfEnabled() ? performance.now() : 0
      const bodyMd = editor.blocksToMarkdownLossy(editor.document)
      if (isKnowledgePerfEnabled()) kbPerfSerialize(performance.now() - t0)
      onDraftChangeRef.current(
        joinYamlFrontmatter(fmTextRef.current, bodyMd),
        { docId: boundDocIdRef.current },
      )
    } catch {
      // keep last good draft
    }
  }, [editor])

  const flushDraft = useCallback(() => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current)
      draftTimerRef.current = null
    }
    if (!draftDirtyRef.current) return
    emitDraft()
  }, [emitDraft])

  const scheduleDraft = useCallback(() => {
    draftDirtyRef.current = true
    if (draftTimerRef.current) return
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null
      emitDraft()
    }, DRAFT_THROTTLE_MS)
  }, [emitDraft])

  useImperativeHandle(
    ref,
    () => ({
      insertMarkdown: (md: string) => {
        try {
          const blocks = editor.tryParseMarkdownToBlocks(md)
          if (blocks.length === 0) return false
          const cursor = editor.getTextCursorPosition()
          editor.insertBlocks(blocks, cursor.block, 'after')
          scheduleDraft()
          return true
        } catch {
          return false
        }
      },
      focus: (opts) => {
        try {
          if (opts?.at === 'end') {
            const last = editor.document[editor.document.length - 1]
            if (last) editor.setTextCursorPosition(last, 'end')
          } else {
            const first = editor.document[0]
            if (first) editor.setTextCursorPosition(first, 'start')
          }
          editor.focus()
          return true
        } catch {
          return false
        }
      },
      flushDraft,
    }),
    [editor, flushDraft, scheduleDraft],
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (next && root.contains(next)) return
      window.setTimeout(() => {
        if (!root.contains(document.activeElement)) {
          flushDraft()
          onBlurRef.current?.()
        }
      }, 0)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        flushDraft()
        onSaveRef.current?.()
      }
    }

    root.addEventListener('focusout', onFocusOut)
    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('focusout', onFocusOut)
      root.removeEventListener('keydown', onKeyDown)
      // Teardown flush is owned by the editor lifecycle effect (avoids double
      // serialize + touching a half-destroyed TipTap view).
    }
  }, [flushDraft])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onPaste = (event: ClipboardEvent) => {
      const sid = spaceIdRef.current
      if (!sid || !event.clipboardData) return
      const items = event.clipboardData.items
      if (!items?.length) return
      void (async () => {
        const res = await importAssetFromClipboardItems(sid, items)
        if (!res) return
        if (!res.ok) {
          onAssetImportErrorRef.current?.(res.reason)
          return
        }
        event.preventDefault()
        onAssetImportedRef.current?.()
        try {
          const blocks = editor.tryParseMarkdownToBlocks(res.markdown)
          const cursor = editor.getTextCursorPosition()
          editor.insertBlocks(blocks, cursor.block, 'after')
          scheduleDraft()
        } catch {
          // ignore
        }
      })()
    }
    root.addEventListener('paste', onPaste, true)
    return () => root.removeEventListener('paste', onPaste, true)
  }, [editor, scheduleDraft])

  return (
    <div
      ref={rootRef}
      className="knowledge-blocknote-editor flex min-h-0 flex-1 flex-col overflow-y-auto pb-24"
      data-testid="knowledge-doc-live-editor"
    >
      <MantineProvider forceColorScheme={isDark ? 'dark' : 'light'}>
        <BlockNoteView
          editor={editor}
          theme={isDark ? 'dark' : 'light'}
          onChange={() => {
            if (skipNextChangeRef.current) return
            scheduleDraft()
          }}
        />
      </MantineProvider>
    </div>
  )
})

DocBlockNoteEditor.displayName = 'DocBlockNoteEditor'

export default DocBlockNoteEditor
