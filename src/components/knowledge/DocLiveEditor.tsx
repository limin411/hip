import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { $prose, getMarkdown, insert } from '@milkdown/kit/utils'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import {
  joinYamlFrontmatter,
  splitYamlFrontmatter,
} from '@/domain/knowledge/frontmatter'
import {
  importAssetFromClipboardItems,
  importAssetFromFile,
} from '@/domain/knowledge/importAsset'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { wikiLinkQueryAt } from '@/domain/knowledge/wikiLink'
import {
  BLOCK_SLASH_IDS,
  KNOWLEDGE_SLASH_ITEMS,
  extractSlashQueryAt,
  filterSlashItemsForLive,
  liveAllowsBlockSlash,
  sameSlashMatch,
  type KnowledgeSlashItem,
  type SlashQueryMatch,
} from '@/domain/knowledge/slashMenu'
import { WikiLinkPicker } from './WikiLinkPicker'
import { KnowledgeSlashMenu } from './KnowledgeSlashMenu'
import { liveCodeBlockPlugins } from './blocks/liveCodeBlockView'
import {
  configureKnowledgeBubble,
  knowledgeBubbleTooltip,
  type BubbleProviderHandle,
} from './blocks/liveBubblePlugins'
import { livePlaceholderPlugins } from './blocks/livePlaceholderPlugin'
import { liveListItemPlugins } from './blocks/liveListItemView'
import { liveCalloutPlugins } from './blocks/liveCalloutView'
import { createLiveBlockHandlePlugin } from './blocks/liveBlockHandle'
import {
  isKnowledgePerfEnabled,
  kbPerfLiveCreateEnd,
  kbPerfLiveCreateStart,
  kbPerfSerialize,
} from '@/domain/knowledge/knowledgePerf'
import i18n from '@/i18n'

import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'

export type DocLiveEditorHandle = {
  /** Structured MD insert via Milkdown `insert` (never multi-line tr.insertText). */
  insertMarkdown: (md: string) => boolean
  /**
   * Focus ProseMirror. Returns false if editor not ready / destroyed.
   * at: 'start' | 'end' — TextSelection near doc start/end + scrollIntoView.
   */
  focus: (opts?: { at?: 'start' | 'end' }) => boolean
  /**
   * Synchronously serialize Live PM → onDraftChange (clears throttle).
   * Call before openDoc / doc switch so store draft is not missing keystrokes.
   */
  flushDraft: () => void
}

export interface DocLiveEditorProps {
  /** Remount key source — parent should also pass key={docId} */
  docId: string
  /** Full markdown including optional YAML frontmatter. */
  initialMarkdown: string
  /**
   * Full markdown (FM re-prefixed). Goes through setDraftBody.
   * Second arg is this editor's bound docId — store should ignore mismatches.
   */
  onDraftChange: (v: string, meta: { docId: string }) => void
  onBlur?: () => void
  /** Optional Cmd/Ctrl+S → flush save (Workspace). */
  onSave?: () => void
  /**
   * Milkdown create/parse failure. Parent should toast and force Source for
   * this doc for the session without writing corrupted body to disk.
   */
  onParseError?: (err: unknown) => void
  placeholder?: string
  /** Current space nodes for Live `[[` wiki fuzzy picker. */
  wikiNodes?: KnowledgeNode[]
  /** Active space for asset paste/drop (mirrors DocEditor). */
  spaceId?: string | null
  /** Toast/surface import failures (too large, unsupported). */
  onAssetImportError?: (
    reason: 'too_large_paste' | 'too_large_disk' | 'unsupported' | 'error',
  ) => void
  onAssetImported?: () => void
  /**
   * K10: `/image` with spaceId → delete slash token and open host file picker
   * (same attach path as the toolbar). Without spaceId, slash inserts skeleton.
   */
  onRequestAttach?: () => void
}

type WikiPickerState = {
  query: string
  /** ProseMirror positions for the open query (after `[[` … cursor). */
  from: number
  to: number
  anchor: { top: number; left: number }
}

type SlashPickerState = {
  match: SlashQueryMatch
  allowBlocks: boolean
  menuPos: { top: number; left: number; width: number; maxHeight: number }
}

const SLASH_MENU_WIDTH = 320
const SLASH_MENU_MAX_H = 224

/**
 * Throttle Live → store draft sync. Milkdown `markdownUpdated` serializes the
 * full document on every transaction; we instead call `getMarkdown()` only on
 * this interval (and flush on blur / Mod-s / unmount).
 */
const LIVE_DRAFT_THROTTLE_MS = 100

function computeSlashMenuPos(
  root: HTMLElement,
  coords: { top: number; bottom: number; left: number },
): SlashPickerState['menuPos'] {
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

/**
 * Apply a slash catalog item into the Live editor.
 *
 * Milkdown `replaceRange` → `markdownToSlice`/`parseSlice` fits the slice into the
 * surrounding paragraph and collapses most block MD (headings, lists, fences).
 * Block items: delete the parent textblock (when line-start/whitespace prefix),
 * then `insert(md)` so the parser yields real PM block nodes. Inline items
 * (`wiki`/`embed`): delete the `/query` token only, then `insert`.
 *
 * Returns false if composing or the editor action throws.
 */
function applyLiveSlashInsert(
  editor: Editor,
  match: SlashQueryMatch,
  item: KnowledgeSlashItem,
  allowBlocks: boolean,
): boolean {
  const view = editor.ctx.get(editorViewCtx)
  if (view.composing) return false

  const isBlock = BLOCK_SLASH_IDS.has(item.id)
  let delFrom = match.from
  let delTo = match.to

  // Expand delete to the whole textblock so the slash paragraph does not remain empty.
  if (isBlock && allowBlocks) {
    const $pos = view.state.doc.resolve(match.from)
    if ($pos.depth >= 1) {
      delFrom = $pos.before()
      delTo = $pos.after()
    }
  }

  const tr = view.state.tr.delete(delFrom, delTo)
  const selPos = Math.min(delFrom, tr.doc.content.size)
  const $sel = tr.doc.resolve(selPos)
  tr.setSelection(TextSelection.near($sel)).scrollIntoView()
  view.dispatch(tr)

  // Structured parse → PM nodes (never multi-line tr.insertText).
  editor.action(insert(item.insert))

  // Best-effort caret from catalog cursorOffset (string offset ≠ PM pos).
  if (item.cursorOffset > 0) {
    try {
      const v = editor.ctx.get(editorViewCtx)
      const target = Math.min(
        delFrom + item.cursorOffset,
        v.state.doc.content.size,
      )
      if (target >= 0 && target <= v.state.doc.content.size) {
        v.dispatch(
          v.state.tr
            .setSelection(TextSelection.near(v.state.doc.resolve(target)))
            .scrollIntoView(),
        )
      }
    } catch {
      // leave default selection after insert
    }
  }

  view.focus()
  return true
}

/**
 * Milkdown kit Live host (not Crepe / @milkdown/react).
 *
 * Frontmatter is stripped before the editor and re-prefixed on serialize.
 * Live is a canonicalizing writer — serializer style may rewrite lists/tables.
 * `/` slash: delete token (or parent block) then structured `insert`; Escape uses `tr.delete`.
 */
export const DocLiveEditor = forwardRef<DocLiveEditorHandle, DocLiveEditorProps>(
  function DocLiveEditor(
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
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null)
    const rootRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<Editor | null>(null)
    const fmTextRef = useRef('')
    /** Bound at mount — this instance only ever speaks for this doc. */
    const boundDocIdRef = useRef(docId)
    boundDocIdRef.current = docId
    /** Flush pending Live draft to store (blur / save / unmount). */
    const flushDraftRef = useRef<() => void>(() => {})
    const onDraftChangeRef = useRef(onDraftChange)
    onDraftChangeRef.current = onDraftChange
    const onBlurRef = useRef(onBlur)
    onBlurRef.current = onBlur
    const onSaveRef = useRef(onSave)
    onSaveRef.current = onSave
    const onParseErrorRef = useRef(onParseError)
    onParseErrorRef.current = onParseError
    const wikiNodesRef = useRef(wikiNodes ?? [])
    wikiNodesRef.current = wikiNodes ?? []
    const spaceIdRef = useRef(spaceId)
    spaceIdRef.current = spaceId
    const onAssetImportErrorRef = useRef(onAssetImportError)
    onAssetImportErrorRef.current = onAssetImportError
    const onAssetImportedRef = useRef(onAssetImported)
    onAssetImportedRef.current = onAssetImported
    const onRequestAttachRef = useRef(onRequestAttach)
    onRequestAttachRef.current = onRequestAttach
    // Capture mount-time markdown only (parent remounts via key on doc switch).
    const initialRef = useRef(initialMarkdown)

    const [picker, setPicker] = useState<WikiPickerState | null>(null)
    const [slash, setSlash] = useState<SlashPickerState | null>(null)
    const slashRef = useRef<SlashPickerState | null>(null)
    slashRef.current = slash
    const pickerRef = useRef<WikiPickerState | null>(null)
    pickerRef.current = picker
    /** Shared with bubble shouldShow — true when slash or wiki menu is open. */
    const menusOpenRef = useRef({ current: false })
    menusOpenRef.current.current = slash != null || picker != null
    const bubbleHandleRef = useRef<BubbleProviderHandle | null>(null)
    const syncPickersRef = useRef<() => void>(() => {})

    const insertMarkdown = useCallback((md: string): boolean => {
      const ed = editorRef.current
      if (!ed || !md) return false
      try {
        // Structured parse → PM nodes (never multi-line tr.insertText).
        ed.action(insert(md))
        return true
      } catch {
        return false
      }
    }, [])

    const focusEditor = useCallback((opts?: { at?: 'start' | 'end' }): boolean => {
      const ed = editorRef.current
      if (!ed) return false
      try {
        const view = ed.ctx.get(editorViewCtx)
        if (!view?.dom) return false
        const at = opts?.at ?? 'start'
        const sel =
          at === 'end'
            ? TextSelection.atEnd(view.state.doc)
            : TextSelection.atStart(view.state.doc)
        view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
        view.focus()
        return true
      } catch {
        return false
      }
    }, [])

    const flushDraft = useCallback(() => {
      flushDraftRef.current()
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        insertMarkdown,
        focus: focusEditor,
        flushDraft,
      }),
      [insertMarkdown, focusEditor, flushDraft],
    )

    const updateSlash = useCallback((next: SlashPickerState | null) => {
      setSlash((prev) => {
        if (!next && !prev) return prev
        if (
          next &&
          prev &&
          sameSlashMatch(prev.match, next.match) &&
          prev.allowBlocks === next.allowBlocks &&
          prev.menuPos.top === next.menuPos.top &&
          prev.menuPos.left === next.menuPos.left
        ) {
          return prev
        }
        return next
      })
    }, [])

    const syncPickers = useCallback(() => {
      const ed = editorRef.current
      const root = rootRef.current
      if (!ed) {
        setPicker(null)
        updateSlash(null)
        return
      }
      try {
        const view = ed.ctx.get(editorViewCtx)
        // IME: do not open/update menus while composing.
        if (view.composing) return

        const { from } = view.state.selection
        if (!view.state.selection.empty) {
          setPicker(null)
          updateSlash(null)
          return
        }
        const $from = view.state.selection.$from
        const blockText = $from.parent.textContent
        const offset = $from.parentOffset
        const blockStart = $from.start()

        // Wiki `[[` wins over slash when both could match.
        const q = wikiLinkQueryAt(blockText, offset)
        if (q) {
          const coords = view.coordsAtPos(from)
          setPicker({
            query: q.query,
            from: blockStart + q.from,
            to: blockStart + q.to,
            anchor: { top: coords.bottom + 4, left: coords.left },
          })
          updateSlash(null)
          return
        }
        setPicker(null)

        const slashMatch = extractSlashQueryAt(blockText, offset, blockStart)
        if (!slashMatch || !root) {
          updateSlash(null)
          return
        }
        const slashFromInBlock = slashMatch.from - blockStart
        const allowBlocks = liveAllowsBlockSlash(blockText, slashFromInBlock)
        const coords = view.coordsAtPos(slashMatch.from)
        updateSlash({
          match: slashMatch,
          allowBlocks,
          menuPos: computeSlashMenuPos(root, coords),
        })
      } catch {
        setPicker(null)
        updateSlash(null)
      }
    }, [updateSlash])

    const applyWikiPick = useCallback(
      (title: string) => {
        const ed = editorRef.current
        const p = picker
        if (!ed || !p) return
        try {
          const view = ed.ctx.get(editorViewCtx)
          const after = view.state.doc.textBetween(p.to, p.to + 2, '\n', '\n')
          const insertText = after === ']]' ? title : `${title}]]`
          view.dispatch(
            view.state.tr.insertText(insertText, p.from, p.to).scrollIntoView(),
          )
          view.focus()
        } catch {
          // ignore
        }
        setPicker(null)
      },
      [picker],
    )

    const onSlashSelect = useCallback(
      (item: KnowledgeSlashItem) => {
        const ed = editorRef.current
        const s = slashRef.current
        if (!ed || !s) return
        try {
          // K10: /image with spaceId → delete token + host attach (toolbar path).
          if (item.id === 'image' && spaceIdRef.current) {
            const view = ed.ctx.get(editorViewCtx)
            if (view.composing) return
            view.dispatch(
              view.state.tr.delete(s.match.from, s.match.to).scrollIntoView(),
            )
            view.focus()
            updateSlash(null)
            onRequestAttachRef.current?.()
            return
          }

          const ok = applyLiveSlashInsert(ed, s.match, item, s.allowBlocks)
          if (!ok) {
            // Composing or no-op — keep menu/token so failure is visible.
            return
          }
          updateSlash(null)
        } catch (err) {
          // Keep menu open; do not silently clear the `/` token.
          console.warn('[DocLiveEditor] slash insert failed', err)
        }
      },
      [updateSlash],
    )

    /** Escape/dismiss: hard-delete `/query` token (not replaceRange('')). */
    const onSlashDismiss = useCallback(() => {
      const ed = editorRef.current
      const s = slashRef.current
      if (ed && s) {
        try {
          const view = ed.ctx.get(editorViewCtx)
          if (!view.composing) {
            view.dispatch(
              view.state.tr.delete(s.match.from, s.match.to).scrollIntoView(),
            )
            view.focus()
          }
        } catch {
          // ignore
        }
      }
      updateSlash(null)
    }, [updateSlash])

    useEffect(() => {
      const root = hostRef.current
      if (!root) return

      let cancelled = false
      let draftTimer: ReturnType<typeof setTimeout> | null = null
      /** Set after `.create()` so the draft-sync plugin can schedule. */
      let liveEditor: Editor | null = null
      const { fmText, body } = splitYamlFrontmatter(initialRef.current)
      fmTextRef.current = fmText

      const emitDraft = (bodyMd: string) => {
        // Always tag with this instance's docId so store can drop stale unmounts.
        onDraftChangeRef.current(
          joinYamlFrontmatter(fmTextRef.current, bodyMd),
          { docId: boundDocIdRef.current },
        )
      }

      const flushDraftFromEditor = () => {
        if (draftTimer) {
          clearTimeout(draftTimer)
          draftTimer = null
        }
        const ed = liveEditor ?? editorRef.current
        if (!ed) return
        try {
          const t0 = isKnowledgePerfEnabled() ? performance.now() : 0
          const bodyMd = ed.action(getMarkdown())
          if (isKnowledgePerfEnabled()) kbPerfSerialize(performance.now() - t0)
          emitDraft(bodyMd)
        } catch {
          // ignore serialize failures; keep last committed draft
        }
      }

      const scheduleDraftFromEditor = () => {
        if (cancelled || draftTimer) return
        draftTimer = setTimeout(() => {
          draftTimer = null
          if (!cancelled) flushDraftFromEditor()
        }, LIVE_DRAFT_THROTTLE_MS)
      }

      flushDraftRef.current = flushDraftFromEditor

      // Empty-paragraph slash hint (R4): CSS variable + decoration class.
      // content: var(...) requires a quoted string value.
      const slashHint = i18n.t('knowledge.doc.emptySlashHint', {
        defaultValue: "Type '/' for commands",
      })
      const slashHintCss = JSON.stringify(slashHint)
      const liveRoot = rootRef.current
      if (liveRoot) {
        liveRoot.style.setProperty('--knowledge-pm-placeholder', slashHintCss)
      }
      root.style.setProperty('--knowledge-pm-placeholder', slashHintCss)

      // Doc changes only — not milkdown markdownUpdated (full serialize every tx).
      const draftSyncPlugin = $prose(
        () =>
          new Plugin({
            view: () => ({
              update(view, prevState) {
                if (view.state.doc.eq(prevState.doc)) return
                scheduleDraftFromEditor()
              },
            }),
          }),
      )

      const blockHandlePlugin = createLiveBlockHandlePlugin({
        onOpened: () => {
          requestAnimationFrame(() => syncPickersRef.current())
        },
      })

      ;(async () => {
        try {
          kbPerfLiveCreateStart()
          const editor = await Editor.make()
            .config((ctx) => {
              ctx.set(rootCtx, root)
              ctx.set(defaultValueCtx, body)
              // Bubble needs root for floating-ui; menusOpenRef tracks slash/wiki.
              configureKnowledgeBubble(
                ctx,
                rootRef.current ?? root,
                menusOpenRef.current,
                bubbleHandleRef,
              )
            })
            .use(commonmark)
            .use(gfm)
            .use(history)
            .use(knowledgeBubbleTooltip)
            .use(livePlaceholderPlugins)
            .use(liveListItemPlugins)
            .use(liveCalloutPlugins)
            .use(liveCodeBlockPlugins)
            .use(blockHandlePlugin)
            .use(draftSyncPlugin)
            .create()

          if (cancelled) {
            await editor.destroy()
            return
          }
          liveEditor = editor
          editorRef.current = editor
          kbPerfLiveCreateEnd()
        } catch (err) {
          if (!cancelled) onParseErrorRef.current?.(err)
        }
      })()

      return () => {
        cancelled = true
        // Commit in-flight edits before tear-down (doc switch / mode change).
        flushDraftFromEditor()
        flushDraftRef.current = () => {}
        const ed = editorRef.current
        editorRef.current = null
        liveEditor = null
        bubbleHandleRef.current = null
        if (ed) void ed.destroy()
        // Clear host so remount starts clean (Milkdown leaves DOM under root).
        root.replaceChildren()
        setPicker(null)
        updateSlash(null)
      }
    }, [updateSlash])

    // Blur + Mod-s + wiki/slash picker sync on the contenteditable host.
    useEffect(() => {
      const host = hostRef.current
      if (!host) return

      const onFocusOut = (e: FocusEvent) => {
        const next = e.relatedTarget as Node | null
        if (next && host.contains(next)) return
        // Delay so picker mousedown can fire first.
        window.setTimeout(() => {
          if (!host.contains(document.activeElement)) {
            setPicker(null)
            updateSlash(null)
            // Flush draft before autosave so we do not write a stale body.
            flushDraftRef.current()
            onBlurRef.current?.()
          }
        }, 0)
      }

      const onKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          flushDraftRef.current()
          onSaveRef.current?.()
          return
        }
        // R4: Escape hides bubble when slash/wiki are closed (menus win first).
        if (e.key === 'Escape') {
          if (slashRef.current || pickerRef.current) return
          const bubble = bubbleHandleRef.current
          if (bubble?.isVisible()) {
            e.preventDefault()
            bubble.hide()
            try {
              editorRef.current?.ctx.get(editorViewCtx).focus()
            } catch {
              // ignore
            }
          }
        }
      }

      const onInputOrKey = () => {
        // After ProseMirror applies the key, re-read selection.
        requestAnimationFrame(() => syncPickers())
      }

      host.addEventListener('focusout', onFocusOut)
      host.addEventListener('keydown', onKeyDown)
      host.addEventListener('keyup', onInputOrKey)
      host.addEventListener('click', onInputOrKey)
      return () => {
        host.removeEventListener('focusout', onFocusOut)
        host.removeEventListener('keydown', onKeyDown)
        host.removeEventListener('keyup', onInputOrKey)
        host.removeEventListener('click', onInputOrKey)
      }
    }, [syncPickers, updateSlash])

    // Keep syncPickersRef current for block-handle openSlash path A.
    useEffect(() => {
      syncPickersRef.current = syncPickers
    }, [syncPickers])

    // Asset paste/drop on the outer Live root (capture, mirror DocEditor).
    useEffect(() => {
      const root = rootRef.current
      if (!root) return

      const handleImportResult = (
        result: Awaited<ReturnType<typeof importAssetFromFile>>,
      ) => {
        if (result.ok) {
          // Import may have written to disk; surface insert failure so user is not silent.
          if (insertMarkdown(result.markdown)) {
            onAssetImportedRef.current?.()
          } else {
            onAssetImportErrorRef.current?.('error')
          }
          return
        }
        onAssetImportErrorRef.current?.(result.reason)
      }

      const onPaste = (event: ClipboardEvent) => {
        const space = spaceIdRef.current
        if (!space || !event.clipboardData) return
        // Fall through until Milkdown is ready so we do not swallow paste with no host.
        if (!editorRef.current) return
        const items = event.clipboardData.items
        if (!items?.length) return
        let hasImage = false
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (
            it.kind === 'file' &&
            it.type.startsWith('image/') &&
            it.type !== 'image/svg+xml'
          ) {
            hasImage = true
            break
          }
        }
        if (!hasImage) return
        event.preventDefault()
        event.stopPropagation()
        void importAssetFromClipboardItems(space, items).then((result) => {
          if (!result) return
          handleImportResult(result)
        })
      }

      const onDrop = (event: DragEvent) => {
        const space = spaceIdRef.current
        if (!space || !event.dataTransfer?.files?.length) return
        if (!editorRef.current) return
        const files = Array.from(event.dataTransfer.files)
        const assets = files.filter((f) => {
          const mime = f.type
          return (
            (mime.startsWith('image/') && mime !== 'image/svg+xml') ||
            mime === 'application/pdf' ||
            /\.(png|jpe?g|gif|webp|pdf)$/i.test(f.name)
          )
        })
        if (!assets.length) return
        event.preventDefault()
        event.stopPropagation()
        void (async () => {
          for (const file of assets) {
            const result = await importAssetFromFile(space, file)
            handleImportResult(result)
          }
        })()
      }

      const onDragOver = (event: DragEvent) => {
        if (!spaceIdRef.current) return
        if (!event.dataTransfer?.types?.includes('Files')) return
        // Allow drop into the Live surface (otherwise browser may navigate).
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }

      root.addEventListener('paste', onPaste, true)
      root.addEventListener('drop', onDrop, true)
      root.addEventListener('dragover', onDragOver, true)
      return () => {
        root.removeEventListener('paste', onPaste, true)
        root.removeEventListener('drop', onDrop, true)
        root.removeEventListener('dragover', onDragOver, true)
      }
    }, [insertMarkdown])

    const slashItems = useMemo(
      () =>
        slash
          ? filterSlashItemsForLive(KNOWLEDGE_SLASH_ITEMS, {
              allowBlocks: slash.allowBlocks,
            })
          : KNOWLEDGE_SLASH_ITEMS,
      [slash],
    )

    return (
      <div
        ref={rootRef}
        className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
        data-testid="knowledge-doc-live-editor"
      >
        <div
          ref={hostRef}
          className="knowledge-live-editor min-h-0 flex-1 overflow-y-auto px-0.5 pb-24 text-prose text-ink outline-none [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:leading-[1.7] [&_.ProseMirror_p]:my-2 [&_.ProseMirror_h1]:mb-3 [&_.ProseMirror_h1]:mt-4 [&_.ProseMirror_h1]:text-xl [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-border [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-ink-secondary [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-surface-subtle [&_.ProseMirror_code]:px-1 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded-md [&_.ProseMirror_pre]:bg-surface-subtle [&_.ProseMirror_pre]:p-3 [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-border [&_.ProseMirror_td]:px-2 [&_.ProseMirror_td]:py-1 [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-border [&_.ProseMirror_th]:px-2 [&_.ProseMirror_th]:py-1 [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_ul]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:my-2 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_p.knowledge-pm-empty]:before:pointer-events-none [&_p.knowledge-pm-empty]:before:float-left [&_p.knowledge-pm-empty]:before:h-0 [&_p.knowledge-pm-empty]:before:text-ink-tertiary [&_p.knowledge-pm-empty]:before:content-[var(--knowledge-pm-placeholder)]"
          data-placeholder={placeholder}
        />
        {slash ? (
          <KnowledgeSlashMenu
            query={slash.match.query}
            items={slashItems}
            onSelect={onSlashSelect}
            onDismiss={onSlashDismiss}
            className="absolute"
            style={{
              top: slash.menuPos.top,
              left: slash.menuPos.left,
              width: slash.menuPos.width,
              maxHeight: slash.menuPos.maxHeight,
            }}
          />
        ) : null}
        {picker ? (
          <WikiLinkPicker
            query={picker.query}
            nodes={wikiNodesRef.current}
            anchor={picker.anchor}
            onPick={applyWikiPick}
            onClose={() => setPicker(null)}
          />
        ) : null}
      </div>
    )
  },
)

DocLiveEditor.displayName = 'DocLiveEditor'

export default DocLiveEditor
