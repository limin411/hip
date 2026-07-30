/**
 * Live Milkdown NodeView for `code_block`.
 *
 * - mermaid → LiveMermaidNodeView (in-place diagram render; this file dispatches)
 * - svg → LiveSvgNodeView (sanitizeSvg rebuild render; this file dispatches)
 * - other langs: chrome (lang badge + copy) + Shiki preview overlay when
 *   selection is outside the node; plain editable contentDOM when inside
 * - contentDOM stays in-flow (never display:none) so PM coords/IME stay stable
 * - CSP-safe Shiki via shikiLazy (JS engine only)
 */

import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
} from '@milkdown/kit/prose/view'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { $prose, $view } from '@milkdown/kit/utils'
import {
  KNOWLEDGE_HIGHLIGHT_LANGS,
  normalizeHighlightLang,
} from '@/domain/knowledge/codeHighlight'
import { isDocDark, subscribeDocTheme } from '@/lib/docTheme'
import { highlightCode } from '@/lib/shikiLazy'
import { copyText } from '@/ipc/clipboard'
import { kbPerfNodeViewMount } from '@/domain/knowledge/knowledgePerf'
import {
  isMermaidLang,
  LiveMermaidNodeView,
  liveMermaidViews,
} from './liveMermaidView'
import {
  isSvgLang,
  LiveSvgNodeView,
  liveSvgViews,
} from './liveSvgView'

const liveViews = new Set<LiveCodeBlockNodeView>()

class LiveCodeBlockNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  private node: Node
  private view: EditorView
  private getPos: () => number | undefined
  private previewEl: HTMLElement
  private editPre: HTMLElement
  private langEl: HTMLSelectElement
  private editing = true
  private highlightGen = 0
  private destroyed = false
  private unsubTheme: (() => void) | null = null

  /** Selection plugin fast-path: skip full walk when no block is in edit mode. */
  get isEditing(): boolean {
    return this.editing
  }

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos

    this.dom = document.createElement('div')
    this.dom.className =
      'knowledge-live-code-block my-2 overflow-hidden rounded-lg border border-border bg-surface-muted/80'
    this.dom.setAttribute('data-testid', 'knowledge-live-code-block')
    this.dom.dataset.language = (node.attrs.language as string) ?? ''
    // Chrome (copy) must not live inside contenteditable or clicks/focus steal
    // collapse the PM selection and bounce the block into preview.
    this.dom.contentEditable = 'false'
    kbPerfNodeViewMount('code')

    const header = document.createElement('div')
    header.className =
      'flex h-7 items-center justify-between gap-2 border-b border-border/80 px-2.5'
    header.contentEditable = 'false'

    this.langEl = document.createElement('select')
    this.langEl.className =
      'min-w-0 max-w-[9rem] truncate rounded border-0 bg-transparent py-0 pl-0 pr-1 text-caption font-medium text-ink-tertiary outline-none hover:text-ink'
    this.langEl.setAttribute('data-testid', 'knowledge-live-code-lang')
    this.langEl.setAttribute('aria-label', 'Language')
    const plainOpt = document.createElement('option')
    plainOpt.value = ''
    plainOpt.textContent = 'plain'
    this.langEl.appendChild(plainOpt)
    for (const lang of KNOWLEDGE_HIGHLIGHT_LANGS) {
      const opt = document.createElement('option')
      opt.value = lang
      opt.textContent = lang
      this.langEl.appendChild(opt)
    }
    const curLang = (node.attrs.language as string) ?? ''
    // Keep raw language even if not in allowlist so it serializes back.
    if (curLang && !KNOWLEDGE_HIGHLIGHT_LANGS.includes(curLang as never)) {
      const extra = document.createElement('option')
      extra.value = curLang
      extra.textContent = curLang
      this.langEl.appendChild(extra)
    }
    this.langEl.value = curLang
    this.langEl.addEventListener('mousedown', (e) => {
      e.stopPropagation()
    })
    this.langEl.addEventListener('change', () => {
      const pos = this.getPos()
      if (pos == null) return
      const language = this.langEl.value
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          language,
        }),
      )
    })

    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.setAttribute('data-testid', 'knowledge-live-code-copy')
    copyBtn.className =
      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-state-hover hover:text-ink'
    copyBtn.title = 'Copy code'
    copyBtn.setAttribute('aria-label', 'Copy code')
    copyBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
    copyBtn.addEventListener('mousedown', (e) => {
      // Keep PM selection; do not steal focus into the button.
      e.preventDefault()
      e.stopPropagation()
    })
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const stayEditing = this.editing || this.selectionInside(this.view)
      void copyText(this.node.textContent).finally(() => {
        if (this.destroyed) return
        // copyText fallback focuses a temporary textarea and can drop the
        // caret outside the fence → selection plugin would flip to preview.
        // Restore edit (and caret) when the user was already editing.
        if (stayEditing) this.enterEdit(true)
      })
    })

    header.append(this.langEl, copyBtn)

    // Body: contentDOM always in-flow; preview overlays when not editing.
    const body = document.createElement('div')
    body.className = 'relative'

    this.editPre = document.createElement('pre')
    this.editPre.className =
      'm-0 overflow-auto bg-transparent p-3 font-mono text-meta text-ink'
    this.editPre.setAttribute('data-testid', 'knowledge-live-code-edit')

    this.contentDOM = document.createElement('code')
    this.contentDOM.spellcheck = false
    this.contentDOM.contentEditable = 'true'
    this.editPre.appendChild(this.contentDOM)

    this.previewEl = document.createElement('pre')
    this.previewEl.className =
      'm-0 cursor-text overflow-auto bg-surface-muted/80 p-3 font-mono text-meta text-ink'
    this.previewEl.setAttribute('data-testid', 'knowledge-live-code-preview')
    // Overlay on top of contentDOM (never take contentDOM out of flow).
    this.previewEl.style.position = 'absolute'
    this.previewEl.style.inset = '0'
    this.previewEl.style.zIndex = '1'
    this.previewEl.style.display = 'none'
    this.previewEl.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.enterEdit(true)
    })

    body.append(this.editPre, this.previewEl)
    this.dom.append(header, body)

    // Start in edit mode so initial contentDOM mapping works; selection
    // plugin may switch to preview once the cursor leaves.
    this.editing = true
    liveViews.add(this)

    // Re-highlight preview when app dark class toggles.
    this.unsubTheme = subscribeDocTheme(() => {
      if (this.destroyed || this.editing || !this.canPreview()) return
      void this.refreshPreview()
    })

    void this.refreshPreview()
  }

  private langRaw(): string {
    return ((this.node.attrs.language as string) ?? '').trim()
  }

  /** Whether this block can show a Shiki preview overlay. */
  private canPreview(): boolean {
    return normalizeHighlightLang(this.langRaw()) != null
  }

  private enterEdit(focus = false) {
    this.editing = true
    // contentDOM stays in flow; only drop the overlay.
    this.editPre.style.opacity = ''
    this.editPre.style.pointerEvents = ''
    this.previewEl.style.display = 'none'
    if (focus) {
      const pos = this.getPos()
      if (pos == null) return
      try {
        const $pos = this.view.state.doc.resolve(pos + 1)
        this.view.dispatch(
          this.view.state.tr
            .setSelection(TextSelection.near($pos))
            .scrollIntoView(),
        )
        this.view.focus()
      } catch {
        // ignore
      }
    }
  }

  private showPreview() {
    if (!this.canPreview()) {
      this.enterEdit(false)
      return
    }
    this.editing = false
    // Keep contentDOM measurable for PM; hide visually under overlay.
    this.editPre.style.opacity = '0'
    this.editPre.style.pointerEvents = 'none'
    this.previewEl.style.display = ''
    void this.refreshPreview()
  }

  private async refreshPreview() {
    if (!this.canPreview()) return
    const code = this.node.textContent
    const lang = normalizeHighlightLang(this.langRaw())
    const gen = ++this.highlightGen

    const paintPlain = () => {
      this.previewEl.replaceChildren()
      const codeEl = document.createElement('code')
      codeEl.textContent = code
      this.previewEl.appendChild(codeEl)
    }

    if (!lang || !code) {
      paintPlain()
      return
    }

    const html = await highlightCode(code, lang, isDocDark())
    if (this.destroyed || gen !== this.highlightGen) return
    if (html) {
      this.previewEl.replaceChildren()
      const codeEl = document.createElement('code')
      // structure:'inline' token spans only — no nested shiki <pre>
      codeEl.innerHTML = html
      this.previewEl.appendChild(codeEl)
    } else {
      paintPlain()
    }
  }

  private selectionInside(view: EditorView): boolean {
    const pos = this.getPos()
    if (pos == null) return false
    const end = pos + this.node.nodeSize
    const { from, to } = view.state.selection
    // Inside if any part of the selection intersects the node (including edges).
    return from < end && to > pos
  }

  /**
   * Called by the selection plugin whenever the editor selection changes.
   * Preview when the caret/selection is entirely outside this node.
   * Ignores updates from a different EditorView (multi-editor safety).
   */
  syncSelection(view: EditorView) {
    if (this.destroyed) return
    if (view !== this.view) return
    if (!this.canPreview()) {
      if (!this.editing) this.enterEdit(false)
      return
    }
    const inside = this.selectionInside(view)
    if (inside) {
      if (!this.editing) this.enterEdit(false)
    } else {
      if (this.editing) this.showPreview()
    }
  }

  update(node: Node): boolean {
    if (node.type.name !== 'code_block') return false
    // Switched to mermaid/svg → force recreate as specialized NodeView.
    if (isMermaidLang(node.attrs.language as string)) return false
    if (isSvgLang(node.attrs.language as string)) return false
    const langChanged =
      (node.attrs.language as string) !== (this.node.attrs.language as string)
    this.node = node
    const lang = (node.attrs.language as string) ?? ''
    if (lang && ![...this.langEl.options].some((o) => o.value === lang)) {
      const extra = document.createElement('option')
      extra.value = lang
      extra.textContent = lang
      this.langEl.appendChild(extra)
    }
    this.langEl.value = lang
    this.dom.dataset.language = lang
    if (!this.editing || langChanged) {
      void this.refreshPreview()
    }
    if (langChanged && !this.canPreview()) {
      this.enterEdit(false)
    }
    return true
  }

  selectNode() {
    this.enterEdit(false)
  }

  deselectNode() {
    this.showPreview()
  }

  setSelection() {
    // Cursor placed inside contentDOM — ensure edit chrome is visible.
    this.enterEdit(false)
  }

  stopEvent(event: Event): boolean {
    const t = event.target as HTMLElement | null
    if (t?.closest?.('button')) return true
    if (t?.closest?.('select')) return true
    // Preview is not contentDOM; swallow so PM does not try to interpret it.
    if (t && this.previewEl.contains(t)) return true
    return false
  }

  ignoreMutation(
    mutation: MutationRecord | { type: string; target: globalThis.Node },
  ): boolean {
    const target = mutation.target
    if (!(target instanceof globalThis.Node)) return false
    // Text edits inside contentDOM must sync to the document.
    if (target === this.contentDOM || this.contentDOM.contains(target)) {
      return false
    }
    // Header / Shiki preview overlay / opacity toggles are view-only.
    // Ignoring prevents NodeView destroy+recreate (edit↔preview bounce).
    if (target === this.dom || this.dom.contains(target)) return true
    return false
  }

  destroy() {
    this.destroyed = true
    liveViews.delete(this)
    this.unsubTheme?.()
    this.unsubTheme = null
  }
}

/** NodeView plugin — registers for all `code_block` nodes; language dispatch. */
export const liveCodeBlockView = $view(
  codeBlockSchema.node,
  (): NodeViewConstructor =>
    (node, view, getPos) => {
      if (isMermaidLang(node.attrs.language as string)) {
        return new LiveMermaidNodeView(node, view, getPos)
      }
      if (isSvgLang(node.attrs.language as string)) {
        return new LiveSvgNodeView(node, view, getPos)
      }
      return new LiveCodeBlockNodeView(node, view, getPos)
    },
)

function selectionInCodeBlock(view: EditorView): boolean {
  const $from = view.state.selection.$from
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'code_block') return true
  }
  return false
}

function anyLiveBlockEditing(): boolean {
  for (const v of liveViews) if (v.isEditing) return true
  for (const v of liveMermaidViews) if (v.isEditing) return true
  for (const v of liveSvgViews) if (v.isEditing) return true
  return false
}

/** Keeps preview/edit mode in sync when the selection moves (code + mermaid + svg). */
export const liveCodeBlockSelectionPlugin = $prose(
  () =>
    new Plugin({
      view() {
        return {
          update(view, prevState) {
            if (prevState && view.state.selection.eq(prevState.selection)) {
              // Doc-only updates: NodeView.update handles preview content.
              return
            }
            const total =
              liveViews.size + liveMermaidViews.size + liveSvgViews.size
            if (total === 0) return
            // Prose typing: caret outside fences and no block in edit → skip O(n) walk.
            if (!selectionInCodeBlock(view) && !anyLiveBlockEditing()) return
            for (const v of liveViews) v.syncSelection(view)
            for (const v of liveMermaidViews) v.syncSelection(view)
            for (const v of liveSvgViews) v.syncSelection(view)
          },
        }
      },
    }),
)

/** Milkdown plugin bundle for DocLiveEditor. */
export const liveCodeBlockPlugins = [
  liveCodeBlockView,
  liveCodeBlockSelectionPlugin,
]
