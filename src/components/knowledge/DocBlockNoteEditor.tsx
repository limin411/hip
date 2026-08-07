/**
 * Live document editor on BlockNote (TipTap/ProseMirror).
 * Thin host: schema, find, keymap, wiki navigate, dialect bridge.
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
import { BlockNoteHipSlashMenu } from './BlockNoteHipSlashMenu'
import { MantineProvider } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { DocFindBar } from './find/DocFindBar'
import { knowledgeBlockSchema } from '@/domain/knowledge/blocks/schema'
import {
  KnowledgeEditorHostContext,
  type KnowledgeEditorHost,
} from '@/domain/knowledge/blocks/knowledgeEditorHostContext'
import {
  detectDialectLoss,
  postSerializeMdFromLive,
  preParseMdForLive,
} from '@/domain/knowledge/blocks/dialectBridge'
import {
  handleBlockKeydown,
  type BlockKeymapEditor,
} from '@/domain/knowledge/blocks/blockKeymap'
import type { KnowledgeAiActionId } from '@/domain/knowledge/ai/knowledgeAiActions'

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
  getSelectionText?: () => string
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
  onAiAction?: (action: KnowledgeAiActionId) => void
  onCreateSubdoc?: () => void
  onCopyPageLink?: () => void
  /** Outline heading labels for AI context (optional). */
  outlineHeadings?: string[]
}

const DRAFT_THROTTLE_MS = 120

/**
 * TipTap EditorContent.componentWillUnmount calls `view.setProps({ nodeViews: {} })`,
 * which re-enters ProseMirror update/iterDeco. Guard setProps/destroy for this view only.
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
      if (part && typeof part === 'object' && 'type' in part) {
        const p = part as { type?: string; props?: { title?: string; alias?: string } }
        if (p.type === 'wikiLink') {
          const alias = p.props?.alias?.trim()
          const title = p.props?.title?.trim() ?? ''
          return alias || title
        }
      }
      return ''
    })
    .join('')
}

function caretAnchor(): { top: number; left: number } {
  try {
    const sel = window.getSelection()
    if (sel?.rangeCount) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (rect && (rect.width || rect.height || rect.top || rect.left)) {
        return { top: rect.bottom + 4, left: rect.left }
      }
    }
  } catch {
    // ignore
  }
  return { top: 120, left: 120 }
}

function coordsAtPos(editor: {
  _tiptapEditor?: {
    view?: {
      coordsAtPos?: (pos: number) => { top: number; bottom: number; left: number }
    }
    state?: { selection?: { from: number } }
  }
}): { top: number; left: number } {
  try {
    const tt = editor._tiptapEditor
    const pos = tt?.state?.selection?.from
    if (typeof pos === 'number' && tt?.view?.coordsAtPos) {
      const c = tt.view.coordsAtPos(pos)
      return { top: c.bottom + 4, left: c.left }
    }
  } catch {
    // ignore
  }
  return caretAnchor()
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
    onAiAction,
    onCreateSubdoc,
    onCopyPageLink,
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
  const onAiActionRef = useRef(onAiAction)
  onAiActionRef.current = onAiAction
  const onCreateSubdocRef = useRef(onCreateSubdoc)
  onCreateSubdocRef.current = onCreateSubdoc
  const onCopyPageLinkRef = useRef(onCopyPageLink)
  onCopyPageLinkRef.current = onCopyPageLink
  const wikiNodesRef = useRef(wikiNodes)
  wikiNodesRef.current = wikiNodes
  const seedBodyRef = useRef('')
  const lossToastShownRef = useRef(false)

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftDirtyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const skipNextChangeRef = useRef(true)
  const isDark = usePrefersDark()
  const codeBlockThemePref = useHipConfigStore((s) =>
    normalizeCodeBlockThemeId(s.config.codeBlock?.colorTheme),
  )
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
  const [findOpen, setFindOpen] = useState(false)
  const [findReplace, setFindReplace] = useState(false)

  const { fmText, body } = useMemo(
    () => splitYamlFrontmatter(initialMarkdown),
    // Parent remounts via key={docId}; seed once per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId],
  )
  fmTextRef.current = fmText
  seedBodyRef.current = body

  const resolvedPlaceholder =
    placeholder ?? t('knowledge.doc.placeholderSlash')

  const editor = useCreateBlockNote(
    {
      schema: knowledgeBlockSchema,
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

  const hostValue = useMemo<KnowledgeEditorHost>(
    () => ({
      spaceId: spaceId ?? null,
      nodes: wikiNodes ?? [],
      onWikiNavigate,
      onOpenDoc: (id, fragment) => {
        onWikiNavigate?.({
          title: '',
          nodeId: id,
          broken: false,
        })
        void fragment
      },
    }),
    [spaceId, wikiNodes, onWikiNavigate],
  )

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
          const bodyMd = postSerializeMdFromLive(
            editor.blocksToMarkdownLossy(editor.document),
          )
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

  // Initial markdown → blocks (via dialect pre-parse)
  useEffect(() => {
    kbPerfLiveCreateStart()
    try {
      skipNextChangeRef.current = true
      const prepared = preParseMdForLive(body || '')
      const blocks = editor.tryParseMarkdownToBlocks(prepared)
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
      const raw = editor.blocksToMarkdownLossy(editor.document)
      const bodyMd = postSerializeMdFromLive(raw)
      if (isKnowledgePerfEnabled()) kbPerfSerialize(performance.now() - t0)

      // Honesty toast once per editor instance if dialect markers lost
      if (!lossToastShownRef.current) {
        const lost = detectDialectLoss(seedBodyRef.current, bodyMd)
        if (lost.length > 0) {
          lossToastShownRef.current = true
          toast.message(t('knowledge.doc.dialectLoss'), {
            description: lost.map((l) => l.id).join(', '),
          })
        }
      }

      onDraftChangeRef.current(
        joinYamlFrontmatter(fmTextRef.current, bodyMd),
        { docId: boundDocIdRef.current },
      )
    } catch {
      // keep last good draft
    }
  }, [editor, t])

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
      const block = editor.getTextCursorPosition().block
      const local = blockPlainText(block)
      const localQ = wikiLinkQueryAt(local, local.length)
      const anchor = coordsAtPos(editor)
      if (localQ) {
        setWikiPicker({
          query: localQ.query,
          from: localQ.from,
          to: localQ.to,
          anchor,
        })
        return
      }
      setWikiPicker({
        query: '',
        from: local.length,
        to: local.length,
        anchor,
      })
    } catch {
      // ignore
    }
  }, [editor])

  const getSlashItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      return buildKnowledgeSlashItems(
        slashEditor,
        {
          labelFor: (id, fallback) =>
            t(slashItemLabelKey(id as KnowledgeSlashId), { defaultValue: fallback }),
          groupLabelFor: (group, fallback) =>
            t(slashGroupLabelKey(group as 'basic'), { defaultValue: fallback }),
          onRequestAttach: () => onRequestAttachRef.current?.(),
          onWikiInsert: () => {
            window.setTimeout(() => openWikiPickerNearCaret(), 0)
          },
          onAiAction: (action) => onAiActionRef.current?.(action),
          onCreateSubdoc: () => onCreateSubdocRef.current?.(),
          onCopyPageLink: () => onCopyPageLinkRef.current?.(),
        },
        query,
      )
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

  const getSelectionText = useCallback((): string => {
    try {
      const sel = window.getSelection()?.toString() ?? ''
      if (sel.trim()) return sel
      const block = editor.getTextCursorPosition().block
      return blockPlainText(block)
    } catch {
      return ''
    }
  }, [editor])

  useImperativeHandle(
    ref,
    () => ({
      insertMarkdown: (md: string) => {
        try {
          const prepared = preParseMdForLive(md)
          const blocks = editor.tryParseMarkdownToBlocks(prepared)
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
      getSelectionText,
    }),
    [editor, flushDraft, scheduleDraft, scrollToHeading, getSelectionText],
  )

  // Keymap: save, find, block ops, headings
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

      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindReplace(Boolean(e.altKey))
        setFindOpen(true)
        return
      }

      if (mod && e.key === 's') {
        e.preventDefault()
        flushDraft()
        onSaveRef.current?.()
        return
      }

      const keymapEditor = editor as unknown as BlockKeymapEditor
      if (handleBlockKeydown(e, keymapEditor)) {
        scheduleDraft()
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

  // Wiki [[ detection + Mod+Click navigate (inline range)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const syncWikiQuery = () => {
      try {
        const block = editor.getTextCursorPosition().block
        const local = blockPlainText(block)
        const localQ = wikiLinkQueryAt(local, local.length)
        if (localQ) {
          setWikiPicker({
            query: localQ.query,
            from: localQ.from,
            to: localQ.to,
            anchor: coordsAtPos(editor),
          })
          return
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

      // Chip path
      const chip = target.closest('[data-testid="knowledge-wiki-chip"]') as HTMLElement | null
      if (chip) {
        if (!(e.metaKey || e.ctrlKey)) return
        const title = chip.getAttribute('data-wiki-title')?.trim() ?? ''
        if (!title) return
        e.preventDefault()
        e.stopPropagation()
        const docs = listDocsInTreeOrder(wikiNodesRef.current ?? [])
        const resolved = resolveWikiTitle(title, docs)
        onWikiNavigateRef.current?.({
          title,
          nodeId: resolved?.id ?? null,
          broken: !resolved,
        })
        return
      }

      // Text range detection for plain [[title]]
      if (!(e.metaKey || e.ctrlKey)) return
      try {
        const sel = document.caretRangeFromPoint?.(e.clientX, e.clientY)
        const textNode = sel?.startContainer
        const offset = sel?.startOffset ?? 0
        const text =
          textNode?.nodeType === Node.TEXT_NODE
            ? textNode.textContent ?? ''
            : (target.textContent ?? '')
        // Find wiki token containing offset
        const re = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g
        let m: RegExpExecArray | null
        while ((m = re.exec(text))) {
          const start = m.index
          const end = start + m[0].length
          if (offset >= start && offset <= end) {
            const title = m[1]!.trim()
            e.preventDefault()
            e.stopPropagation()
            const docs = listDocsInTreeOrder(wikiNodesRef.current ?? [])
            const resolved = resolveWikiTitle(title, docs)
            onWikiNavigateRef.current?.({
              title,
              nodeId: resolved?.id ?? null,
              broken: !resolved,
            })
            return
          }
        }
      } catch {
        // ignore
      }
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
          const prepared = preParseMdForLive(res.markdown)
          const blocks = editor.tryParseMarkdownToBlocks(prepared)
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
          // Prefer wikiLink inline when block is empty-ish after insert
          const onlyWiki = next.trim() === formatWikiLink(title)
          if (onlyWiki) {
            editor.updateBlock(block, {
              type: 'paragraph',
              content: [
                {
                  type: 'wikiLink',
                  props: { title, alias: '' },
                },
              ],
            } as never)
          } else {
            editor.updateBlock(block, {
              type: 'paragraph',
              content: next,
            } as never)
          }
        } else {
          editor.updateBlock(block, {
            type: 'paragraph',
            content: [
              {
                type: 'wikiLink',
                props: { title, alias: '' },
              },
            ],
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
    <KnowledgeEditorHostContext.Provider value={hostValue}>
      <div
        ref={rootRef}
        className="knowledge-blocknote-editor knowledge-doc-measure flex min-h-0 flex-1 flex-col overflow-y-auto"
        data-testid="knowledge-doc-live-editor"
        data-code-block-theme={codeBlockThemePref}
        style={codeBlockStyle}
      >
        <DocFindBar
          open={findOpen}
          onClose={() => setFindOpen(false)}
          root={rootRef.current}
          enableReplace={findReplace}
        />
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
              suggestionMenuComponent={BlockNoteHipSlashMenu}
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
    </KnowledgeEditorHostContext.Provider>
  )
})

DocBlockNoteEditor.displayName = 'DocBlockNoteEditor'

export default DocBlockNoteEditor
