/**
 * Live Milkdown NodeView for `code_block`.
 *
 * - mermaid → LiveMermaidNodeView (in-place diagram render; this file dispatches)
 * - svg: plain editable passthrough (PR-5 specializes)
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
import { normalizeHighlightLang } from '@/domain/knowledge/codeHighlight'
import { isDocDark, subscribeDocTheme } from '@/lib/docTheme'
import { highlightCode } from '@/lib/shikiLazy'
import { copyText } from '@/ipc/clipboard'
import {
  isMermaidLang,
  LiveMermaidNodeView,
  liveMermaidViews,
} from './liveMermaidView'

/** Languages deferred to later PRs (SVG fence). mermaid is handled by LiveMermaidNodeView. */
const PASSTHROUGH_LANGS = new Set(['svg'])

const liveViews = new Set<LiveCodeBlockNodeView>()

class LiveCodeBlockNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  private node: Node
  private view: EditorView
  private getPos: () => number | undefined
  private previewEl: HTMLElement
  private editPre: HTMLElement
  private langEl: HTMLElement
  private editing = true
  private highlightGen = 0
  private destroyed = false
  private unsubTheme: (() => void) | null = null

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

    const header = document.createElement('div')
    header.className =
      'flex h-7 items-center justify-between gap-2 border-b border-border/80 px-2.5'

    this.langEl = document.createElement('span')
    this.langEl.className =
      'min-w-0 truncate text-caption font-medium text-ink-tertiary'
    this.langEl.textContent = (node.attrs.language as string) ?? ''

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
    })
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      void copyText(this.node.textContent)
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

  private isPassthrough(): boolean {
    return PASSTHROUGH_LANGS.has(this.langRaw().toLowerCase())
  }

  /** Whether this block can show a Shiki preview overlay. */
  private canPreview(): boolean {
    if (this.isPassthrough()) return false
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
    const pos = this.getPos()
    if (pos == null) return
    const end = pos + this.node.nodeSize
    const { from, to } = view.state.selection
    // Inside if any part of the selection intersects the node (including edges).
    const inside = from < end && to > pos
    if (inside) {
      if (!this.editing) this.enterEdit(false)
    } else {
      if (this.editing) this.showPreview()
    }
  }

  update(node: Node): boolean {
    if (node.type.name !== 'code_block') return false
    // Switched to mermaid → force recreate as LiveMermaidNodeView.
    if (isMermaidLang(node.attrs.language as string)) return false
    const langChanged =
      (node.attrs.language as string) !== (this.node.attrs.language as string)
    this.node = node
    this.langEl.textContent = (node.attrs.language as string) ?? ''
    this.dom.dataset.language = (node.attrs.language as string) ?? ''
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
    // Preview is not contentDOM; swallow so PM does not try to interpret it.
    if (t && this.previewEl.contains(t)) return true
    return false
  }

  ignoreMutation(
    mutation: MutationRecord | { type: string; target: globalThis.Node },
  ): boolean {
    const target = mutation.target
    if (target === this.previewEl || this.previewEl.contains(target)) return true
    if (target === this.langEl || this.langEl.contains(target)) return true
    if (target === this.dom) return true
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
      return new LiveCodeBlockNodeView(node, view, getPos)
    },
)

/** Keeps preview/edit mode in sync when the selection moves (code + mermaid). */
export const liveCodeBlockSelectionPlugin = $prose(
  () =>
    new Plugin({
      view() {
        return {
          update(view) {
            for (const v of liveViews) v.syncSelection(view)
            for (const v of liveMermaidViews) v.syncSelection(view)
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
