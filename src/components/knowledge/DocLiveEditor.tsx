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
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { history } from '@milkdown/kit/plugin/history'
import { getMarkdown, insert, replaceRange } from '@milkdown/kit/utils'
import {
  joinYamlFrontmatter,
  splitYamlFrontmatter,
} from '@/domain/knowledge/frontmatter'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { wikiLinkQueryAt } from '@/domain/knowledge/wikiLink'
import {
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

import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'

export type DocLiveEditorHandle = {
  /** Structured MD insert via Milkdown `insert` (never multi-line tr.insertText). */
  insertMarkdown: (md: string) => boolean
}

export interface DocLiveEditorProps {
  /** Remount key source — parent should also pass key={docId} */
  docId: string
  /** Full markdown including optional YAML frontmatter. */
  initialMarkdown: string
  /** Full markdown (FM re-prefixed). Goes through setDraftBody. */
  onDraftChange: (v: string) => void
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
 * Milkdown kit Live host (not Crepe / @milkdown/react).
 *
 * Frontmatter is stripped before the editor and re-prefixed on serialize.
 * Live is a canonicalizing writer — serializer style may rewrite lists/tables.
 * `/` slash uses structured `replaceRange`; Escape uses `tr.delete` on the token.
 */
export const DocLiveEditor = forwardRef<DocLiveEditorHandle, DocLiveEditorProps>(
  function DocLiveEditor(
    {
      docId: _docId,
      initialMarkdown,
      onDraftChange,
      onBlur,
      onSave,
      onParseError,
      placeholder,
      wikiNodes,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null)
    const rootRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<Editor | null>(null)
    const fmTextRef = useRef('')
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
    // Capture mount-time markdown only (parent remounts via key on doc switch).
    const initialRef = useRef(initialMarkdown)

    const [picker, setPicker] = useState<WikiPickerState | null>(null)
    const [slash, setSlash] = useState<SlashPickerState | null>(null)
    const slashRef = useRef<SlashPickerState | null>(null)
    slashRef.current = slash

    useImperativeHandle(
      ref,
      () => ({
        insertMarkdown: (md: string) => {
          const ed = editorRef.current
          if (!ed || !md) return false
          try {
            // Structured parse → PM nodes (never multi-line tr.insertText).
            ed.action(insert(md))
            return true
          } catch {
            return false
          }
        },
      }),
      [],
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
          const view = ed.ctx.get(editorViewCtx)
          if (view.composing) return
          // Structured MD → PM nodes (block fences/tables must not use insertText).
          ed.action(
            replaceRange(item.insert, {
              from: s.match.from,
              to: s.match.to,
            }),
          )
          view.focus()
        } catch {
          // ignore
        }
        updateSlash(null)
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
      const { fmText, body } = splitYamlFrontmatter(initialRef.current)
      fmTextRef.current = fmText

      const emitDraft = (bodyMd: string) => {
        onDraftChangeRef.current(joinYamlFrontmatter(fmTextRef.current, bodyMd))
      }

      ;(async () => {
        try {
          const editor = await Editor.make()
            .config((ctx) => {
              ctx.set(rootCtx, root)
              ctx.set(defaultValueCtx, body)
              const l = ctx.get(listenerCtx)
              l.markdownUpdated((_ctx, markdown, prevMarkdown) => {
                if (markdown === prevMarkdown) return
                emitDraft(markdown)
              })
            })
            .use(listener)
            .use(commonmark)
            .use(gfm)
            .use(history)
            .create()

          if (cancelled) {
            await editor.destroy()
            return
          }
          editorRef.current = editor
        } catch (err) {
          if (!cancelled) onParseErrorRef.current?.(err)
        }
      })()

      return () => {
        cancelled = true
        const ed = editorRef.current
        editorRef.current = null
        if (ed) void ed.destroy()
        // Clear host so remount starts clean (Milkdown leaves DOM under root).
        root.replaceChildren()
        setPicker(null)
        updateSlash(null)
      }
    }, [updateSlash])

    // Blur + Mod-s + wiki/slash picker sync on the contenteditable host.
    useEffect(() => {
      const root = hostRef.current
      if (!root) return

      const onFocusOut = (e: FocusEvent) => {
        const next = e.relatedTarget as Node | null
        if (next && root.contains(next)) return
        // Delay so picker mousedown can fire first.
        window.setTimeout(() => {
          if (!root.contains(document.activeElement)) {
            setPicker(null)
            updateSlash(null)
            onBlurRef.current?.()
          }
        }, 0)
      }

      const onKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          // Flush latest markdown before save in case listener is lagging.
          const ed = editorRef.current
          if (ed) {
            try {
              const bodyMd = ed.action(getMarkdown())
              onDraftChangeRef.current(
                joinYamlFrontmatter(fmTextRef.current, bodyMd),
              )
            } catch {
              // ignore; still invoke save with last draft
            }
          }
          onSaveRef.current?.()
        }
      }

      const onInputOrKey = () => {
        // After ProseMirror applies the key, re-read selection.
        requestAnimationFrame(() => syncPickers())
      }

      root.addEventListener('focusout', onFocusOut)
      root.addEventListener('keydown', onKeyDown)
      root.addEventListener('keyup', onInputOrKey)
      root.addEventListener('click', onInputOrKey)
      return () => {
        root.removeEventListener('focusout', onFocusOut)
        root.removeEventListener('keydown', onKeyDown)
        root.removeEventListener('keyup', onInputOrKey)
        root.removeEventListener('click', onInputOrKey)
      }
    }, [syncPickers, updateSlash])

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
          className="knowledge-live-editor min-h-0 flex-1 overflow-y-auto px-0.5 pb-24 text-prose text-ink outline-none [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:leading-[1.7] [&_.ProseMirror_p]:my-2 [&_.ProseMirror_h1]:mb-3 [&_.ProseMirror_h1]:mt-4 [&_.ProseMirror_h1]:text-xl [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-border [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-ink-secondary [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-surface-subtle [&_.ProseMirror_code]:px-1 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded-md [&_.ProseMirror_pre]:bg-surface-subtle [&_.ProseMirror_pre]:p-3 [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-border [&_.ProseMirror_td]:px-2 [&_.ProseMirror_td]:py-1 [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-border [&_.ProseMirror_th]:px-2 [&_.ProseMirror_th]:py-1 [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_ul]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:my-2 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6"
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

export default DocLiveEditor
