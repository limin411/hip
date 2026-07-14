import { useEffect, useRef } from 'react'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { history } from '@milkdown/kit/plugin/history'
import { getMarkdown } from '@milkdown/kit/utils'
import {
  joinYamlFrontmatter,
  splitYamlFrontmatter,
} from '@/domain/knowledge/frontmatter'

import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'

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
}

/**
 * Milkdown kit Live host (not Crepe / @milkdown/react).
 *
 * Frontmatter is stripped before the editor and re-prefixed on serialize.
 * Live is a canonicalizing writer — serializer style may rewrite lists/tables.
 */
export function DocLiveEditor({
  docId: _docId,
  initialMarkdown,
  onDraftChange,
  onBlur,
  onSave,
  onParseError,
  placeholder,
}: DocLiveEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
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
  // Capture mount-time markdown only (parent remounts via key on doc switch).
  const initialRef = useRef(initialMarkdown)

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
    }
  }, [])

  // Blur + Mod-s on the contenteditable host (capture phase).
  useEffect(() => {
    const root = hostRef.current
    if (!root) return

    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (next && root.contains(next)) return
      onBlurRef.current?.()
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

    root.addEventListener('focusout', onFocusOut)
    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('focusout', onFocusOut)
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="knowledge-doc-live-editor"
    >
      <div
        ref={hostRef}
        className="knowledge-live-editor min-h-0 flex-1 overflow-y-auto px-0.5 pb-24 text-prose text-ink outline-none [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:leading-[1.7] [&_.ProseMirror_p]:my-2 [&_.ProseMirror_h1]:mb-3 [&_.ProseMirror_h1]:mt-4 [&_.ProseMirror_h1]:text-xl [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-border [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-ink-secondary [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-surface-subtle [&_.ProseMirror_code]:px-1 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded-md [&_.ProseMirror_pre]:bg-surface-subtle [&_.ProseMirror_pre]:p-3 [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-border [&_.ProseMirror_td]:px-2 [&_.ProseMirror_td]:py-1 [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-border [&_.ProseMirror_th]:px-2 [&_.ProseMirror_th]:py-1 [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_ul]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:my-2 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6"
        data-placeholder={placeholder}
      />
    </div>
  )
}

export default DocLiveEditor
