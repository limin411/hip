/**
 * Live document editor on BlockNote (TipTap/ProseMirror).
 * Notion-class block UX (hip slash, side menu drag, slim bubble toolbar).
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
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { MantineProvider } from '@mantine/core'
import { useTranslation } from 'react-i18next'
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
import {
  buildKnowledgeSlashItems,
  type BlockNoteSlashEditor,
} from '@/domain/knowledge/blockNoteSlash'
import {
  formatWikiLink,
  listDocsInTreeOrder,
  resolveWikiTitle,
  wikiLinkQueryAt,
} from '@/domain/knowledge/wikiLink'
import {
  slashGroupLabelKey,
  slashItemLabelKey,
  type KnowledgeSlashId,
} from '@/domain/knowledge/slashMenu'
import {
  CODE_BLOCK_CHROME,
  normalizeCodeBlockThemeId,
} from '@/domain/knowledge/codeBlockTheme'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { WikiLinkPicker } from './WikiLinkPicker'

import '@blocknote/mantine/style.css'
import '@mantine/core/styles.css'
import './knowledge-blocknote.css'

/** Same handle surface as legacy DocLiveEditor (Workspace / attach paths). */
export type DocLiveEditorHandle = {
  insertMarkdown: (md: string) => boolean
  focus: (opts?: { at?: 'start' | 'end' }) => boolean
  flushDraft: () => void
  /** Scroll to heading by outline text + occurrence (0-based). */
  scrollToHeading?: (text: string, occurrence?: number) => boolean
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

function blockPlainText(block: {
  content?: unknown
}): string {
  const c = block.content
  if (!Array.isArray(c)) return typeof c === 'string' ? c : ''
  return c
    .map((part) => {
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: string }).text ?? '')
      }
      return ''
    })
    .join('')
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
    wikiNodes,
    spaceId,
    onAssetImportError,
    onAssetImported,
    onRequestAttach,
    onWikiNavigate,
  },
  ref,
) {
  const { t } = useTranslation()
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
  const onRequestAttachRef = useRef(onRequestAttach)
  onRequestAttachRef.current = onRequestAttach
  const onWikiNavigateRef = useRef(onWikiNavigate)
  onWikiNavigateRef.current = onWikiNavigate
  const wikiNodesRef = useRef(wikiNodes)
  wikiNodesRef.current = wikiNodes

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftDirtyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const skipNextChangeRef = useRef(true)
  const isDark = usePrefersDark()
  const codeBlockThemePref = useHipConfigStore((s) =>
    normalizeCodeBlockThemeId(s.config.codeBlock?.colorTheme),
  )
  /** Resolved chrome for Live code blocks (matches chat CodeBlock). */
  const codeBlockChrome = useMemo(() => {
    const mode =
      codeBlockThemePref === 'follow'
        ? isDark
          ? 'dark'
          : 'light'
        : codeBlockThemePref
    return CODE_BLOCK_CHROME[mode]
  }, [codeBlockThemePref, isDark])
  const codeBlockStyle = useMemo(
    () =>
      ({
        ['--kb-code-bg' as string]: codeBlockChrome.background,
        ['--kb-code-fg' as string]: codeBlockChrome.text,
        ['--kb-code-border' as string]: codeBlockChrome.border,
      }) as React.CSSProperties,
    [codeBlockChrome],
  )

  const [wikiPicker, setWikiPicker] = useState<{
    query: string
    from: number
    to: number
    anchor: { top: number; left: number }
  } | null>(null)

  const { fmText, body } = useMemo(
    () => splitYamlFrontmatter(initialMarkdown),
    // Parent remounts via key={docId}; seed once per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId],
  )
  fmTextRef.current = fmText

  const resolvedPlaceholder =
    placeholder ?? t('knowledge.doc.placeholder')

  const editor = useCreateBlockNote(
    {
      placeholders: {
        default: resolvedPlaceholder,
      },
      setIdAttribute: true,
      tables: {
        headers: true,
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

  const slashEditor = editor as unknown as BlockNoteSlashEditor

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
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
    const tmr = window.setTimeout(() => {
      skipNextChangeRef.current = false
    }, 0)
    return () => window.clearTimeout(tmr)
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

  const openWikiPickerNearCaret = useCallback(() => {
    try {
      const md = editor.blocksToMarkdownLossy(editor.document)
      // Approximate caret at end of current block text within full md is hard;
      // use last open [[ in whole doc near selection via tiptap.
      const tt = editor._tiptapEditor
      const pos = tt?.state?.selection?.from ?? md.length
      const q = wikiLinkQueryAt(md, Math.min(pos, md.length))
      if (!q) {
        // Fallback: empty query at end of first [[ skeleton
        const idx = md.lastIndexOf('[[')
        if (idx < 0) return
        const from = idx + 2
        const sel = window.getSelection()
        const range = sel?.rangeCount ? sel.getRangeAt(0) : null
        const rect = range?.getBoundingClientRect()
        setWikiPicker({
          query: '',
          from,
          to: from,
          anchor: {
            top: (rect?.bottom ?? 120) + 4,
            left: rect?.left ?? 120,
          },
        })
        return
      }
      const sel = window.getSelection()
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null
      const rect = range?.getBoundingClientRect()
      setWikiPicker({
        query: q.query,
        from: q.from,
        to: q.to,
        anchor: {
          top: (rect?.bottom ?? 120) + 4,
          left: rect?.left ?? 120,
        },
      })
    } catch {
      // ignore
    }
  }, [editor])

  const getSlashItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      return buildKnowledgeSlashItems(slashEditor, {
        labelFor: (id, fallback) =>
          t(slashItemLabelKey(id as KnowledgeSlashId), { defaultValue: fallback }),
        groupLabelFor: (group, fallback) =>
          t(slashGroupLabelKey(group as 'basic'), { defaultValue: fallback }),
        onRequestAttach: () => onRequestAttachRef.current?.(),
        onWikiInsert: () => {
          window.setTimeout(() => openWikiPickerNearCaret(), 0)
        },
      }, query)
    },
    [slashEditor, t, openWikiPickerNearCaret],
  )

  const scrollToHeading = useCallback(
    (text: string, occurrence = 0): boolean => {
      try {
        const target = text.trim()
        let seen = 0
        for (const block of editor.document) {
          if (block.type !== 'heading') continue
          const label = blockPlainText(block).trim()
          if (label !== target) continue
          if (seen === occurrence) {
            const el =
              typeof document !== 'undefined'
                ? document.getElementById(block.id)
                : null
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              try {
                editor.setTextCursorPosition(block, 'start')
              } catch {
                // ignore
              }
              return true
            }
            // Fallback: DOM query by text
            const root = rootRef.current
            if (root) {
              const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6')
              let n = 0
              for (const h of headings) {
                if ((h.textContent ?? '').trim() !== target) continue
                if (n === occurrence) {
                  ;(h as HTMLElement).scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  })
                  return true
                }
                n += 1
              }
            }
            return false
          }
          seen += 1
        }
      } catch {
        return false
      }
      return false
    },
    [editor],
  )

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
      scrollToHeading,
    }),
    [editor, flushDraft, scheduleDraft, scrollToHeading],
  )

  // Keymap: save + Source-aligned shortcuts
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
      if (e.isComposing) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 's') {
        e.preventDefault()
        flushDraft()
        onSaveRef.current?.()
        return
      }
      // Heading shortcuts Mod-Alt-1/2/3
      if (mod && e.altKey && !e.shiftKey) {
        const level =
          e.key === '1' || e.code === 'Digit1'
            ? 1
            : e.key === '2' || e.code === 'Digit2'
              ? 2
              : e.key === '3' || e.code === 'Digit3'
                ? 3
                : 0
        if (level) {
          e.preventDefault()
          try {
            const block = editor.getTextCursorPosition().block
            editor.updateBlock(block, {
              type: 'heading',
              props: { level },
            })
            scheduleDraft()
          } catch {
            // ignore
          }
        }
      }
      // Lists / quote — match Source where possible
      if (mod && e.shiftKey) {
        const k = e.key.toLowerCase()
        try {
          if (k === '8' || e.code === 'Digit8') {
            e.preventDefault()
            editor.updateBlock(editor.getTextCursorPosition().block, {
              type: 'bulletListItem',
            })
            scheduleDraft()
          } else if (k === '7' || e.code === 'Digit7') {
            e.preventDefault()
            editor.updateBlock(editor.getTextCursorPosition().block, {
              type: 'numberedListItem',
            })
            scheduleDraft()
          } else if (k === '.' || e.code === 'Period') {
            e.preventDefault()
            editor.updateBlock(editor.getTextCursorPosition().block, {
              type: 'quote',
            })
            scheduleDraft()
          }
        } catch {
          // ignore
        }
      }
    }

    root.addEventListener('focusout', onFocusOut)
    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('focusout', onFocusOut)
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [editor, flushDraft, scheduleDraft])

  // Wiki [[ detection + click navigate
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const syncWikiQuery = () => {
      if (typeof document !== 'undefined' && document.activeElement) {
        // skip during IME
      }
      try {
        const md = editor.blocksToMarkdownLossy(editor.document)
        const tt = editor._tiptapEditor
        const pos = tt?.state?.selection?.from
        // Prefer block-local text for open [[
        const block = editor.getTextCursorPosition().block
        const local = blockPlainText(block)
        const localQ = wikiLinkQueryAt(local, local.length)
        if (localQ) {
          const sel = window.getSelection()
          const range = sel?.rangeCount ? sel.getRangeAt(0) : null
          const rect = range?.getBoundingClientRect()
          setWikiPicker({
            query: localQ.query,
            from: localQ.from,
            to: localQ.to,
            anchor: {
              top: (rect?.bottom ?? 120) + 4,
              left: rect?.left ?? 120,
            },
          })
          return
        }
        if (typeof pos === 'number') {
          const q = wikiLinkQueryAt(md, Math.min(pos, md.length))
          if (q) {
            const sel = window.getSelection()
            const range = sel?.rangeCount ? sel.getRangeAt(0) : null
            const rect = range?.getBoundingClientRect()
            setWikiPicker({
              query: q.query,
              from: q.from,
              to: q.to,
              anchor: {
                top: (rect?.bottom ?? 120) + 4,
                left: rect?.left ?? 120,
              },
            })
            return
          }
        }
        setWikiPicker(null)
      } catch {
        // ignore
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.isComposing) return
      syncWikiQuery()
    }

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      // Walk text for [[title]] near click
      const blockEl = target.closest('[data-id], [data-node-type], .bn-block-content')
      const text = (blockEl?.textContent ?? target.textContent ?? '').trim()
      const m = text.match(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/)
      if (!m) return
      const title = m[1].trim()
      if (!title) return
      // Only navigate when click is on a link-like span or double-click-ish intent:
      // if user is editing, single click shouldn't always navigate — require meta/ctrl or existing wiki class
      if (!(e.metaKey || e.ctrlKey || target.closest('a'))) {
        // Allow plain click if the whole block is just the wiki link
        if (text !== m[0] && !text.startsWith(m[0])) return
      }
      e.preventDefault()
      e.stopPropagation()
      const docs = listDocsInTreeOrder(wikiNodesRef.current ?? [])
      const resolved = resolveWikiTitle(title, docs)
      onWikiNavigateRef.current?.({
        title,
        nodeId: resolved?.id ?? null,
        broken: !resolved,
      })
    }

    root.addEventListener('keyup', onKeyUp)
    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('keyup', onKeyUp)
      root.removeEventListener('click', onClick)
    }
  }, [editor])

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

  const onWikiPick = useCallback(
    (title: string) => {
      if (!wikiPicker) return
      try {
        const block = editor.getTextCursorPosition().block
        const text = blockPlainText(block)
        const q = wikiLinkQueryAt(text, text.length)
        if (q) {
          const before = text.slice(0, q.from)
          const after = text.slice(q.to)
          const needsClose = !after.startsWith(']]')
          const insert = needsClose ? `${title}]]` : title
          const next = before + insert + after
          // Content blocks only (paragraph/heading/list…); cast avoids table union.
          editor.updateBlock(block, {
            type: 'paragraph',
            content: next,
          } as never)
        } else {
          editor.updateBlock(block, {
            type: 'paragraph',
            content: formatWikiLink(title),
          } as never)
        }
        scheduleDraft()
      } catch {
        // ignore
      }
      setWikiPicker(null)
      try {
        editor.focus()
      } catch {
        // ignore
      }
    },
    [editor, scheduleDraft, wikiPicker],
  )

  return (
    <div
      ref={rootRef}
      className="knowledge-blocknote-editor knowledge-doc-measure flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="knowledge-doc-live-editor"
      data-code-block-theme={codeBlockThemePref}
      style={codeBlockStyle}
    >
      <MantineProvider forceColorScheme={isDark ? 'dark' : 'light'}>
        <BlockNoteView
          editor={editor}
          theme={isDark ? 'dark' : 'light'}
          slashMenu={false}
          formattingToolbar={false}
          onChange={() => {
            if (skipNextChangeRef.current) return
            scheduleDraft()
          }}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={getSlashItems}
          />
          <FormattingToolbarController
            formattingToolbar={() => (
              <FormattingToolbar>
                <BlockTypeSelect key="blockTypeSelect" />
                <BasicTextStyleButton basicTextStyle="bold" key="bold" />
                <BasicTextStyleButton basicTextStyle="italic" key="italic" />
                <BasicTextStyleButton
                  basicTextStyle="underline"
                  key="underline"
                />
                <BasicTextStyleButton
                  basicTextStyle="strike"
                  key="strike"
                />
                <BasicTextStyleButton basicTextStyle="code" key="code" />
                <CreateLinkButton key="createLink" />
              </FormattingToolbar>
            )}
          />
        </BlockNoteView>
      </MantineProvider>
      {wikiPicker ? (
        <WikiLinkPicker
          query={wikiPicker.query}
          nodes={wikiNodes ?? []}
          anchor={wikiPicker.anchor}
          onPick={onWikiPick}
          onClose={() => setWikiPicker(null)}
        />
      ) : null}
    </div>
  )
})

DocBlockNoteEditor.displayName = 'DocBlockNoteEditor'

export default DocBlockNoteEditor
