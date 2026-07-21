/**
 * Live Milkdown NodeView for ```svg code_block fences.
 *
 * Block-internal edit/preview (Notion/Feishu style):
 * - Default / blur: render via KnowledgeSvg (sanitizeSvg rebuild)
 * - Focus / click: editable source (contentDOM)
 *
 * contentDOM stays in the document (never `display:none`); collapsed out of
 * flow while previewing so a tall figure can size the block.
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Node } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { KnowledgeSvg } from '../KnowledgeSvg'

export const liveSvgViews = new Set<LiveSvgNodeView>()

function isSvgLang(lang: string | null | undefined): boolean {
  return ((lang ?? '').trim().toLowerCase() === 'svg')
}

export class LiveSvgNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  private node: Node
  private view: EditorView
  private getPos: () => number | undefined
  private editShell: HTMLElement
  private editPre: HTMLElement
  private previewHost: HTMLElement
  private reactRoot: Root | null = null
  private editing = true
  private destroyed = false
  private lastPreviewCode: string | null = null

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
      'knowledge-live-svg my-2 overflow-hidden rounded-lg border border-border bg-surface-muted/40'
    this.dom.setAttribute('data-testid', 'knowledge-live-svg')
    this.dom.dataset.language = 'svg'

    const body = document.createElement('div')
    body.className = 'relative min-h-[3rem]'

    this.editShell = document.createElement('div')
    this.editShell.className = 'min-h-[3rem]'

    this.editPre = document.createElement('pre')
    this.editPre.className =
      'm-0 overflow-auto bg-transparent p-3 font-mono text-meta text-ink'
    this.contentDOM = document.createElement('code')
    this.contentDOM.spellcheck = false
    this.editPre.appendChild(this.contentDOM)
    this.editShell.appendChild(this.editPre)

    this.previewHost = document.createElement('div')
    this.previewHost.className = 'cursor-text overflow-x-auto p-2'
    this.previewHost.style.display = 'none'
    this.previewHost.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.enterEdit(true)
    })

    body.append(this.editShell, this.previewHost)
    this.dom.appendChild(body)

    liveSvgViews.add(this)

    // Figure-first when source exists; empty fences stay in edit for typing.
    if (node.textContent.trim()) {
      this.showPreview()
    } else {
      this.editing = true
      this.dom.dataset.editing = 'true'
      this.editShell.setAttribute('data-testid', 'knowledge-live-svg-editing')
    }

    queueMicrotask(() => {
      if (!this.destroyed) this.syncSelection(this.view)
    })
  }

  private enterEdit(focus = false) {
    this.editing = true
    this.dom.dataset.editing = 'true'
    this.editShell.setAttribute('data-testid', 'knowledge-live-svg-editing')
    this.editShell.style.position = ''
    this.editShell.style.height = ''
    this.editShell.style.minHeight = ''
    this.editShell.style.overflow = ''
    this.editShell.style.opacity = ''
    this.editShell.style.pointerEvents = ''
    this.previewHost.style.display = 'none'
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
    this.editing = false
    this.dom.dataset.editing = 'false'
    this.editShell.removeAttribute('data-testid')
    this.editShell.style.position = 'absolute'
    this.editShell.style.height = '0'
    this.editShell.style.minHeight = '0'
    this.editShell.style.overflow = 'hidden'
    this.editShell.style.opacity = '0'
    this.editShell.style.pointerEvents = 'none'
    this.previewHost.style.display = ''
    this.mountPreview()
  }

  private mountPreview() {
    if (this.destroyed) return
    const code = this.node.textContent
    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.previewHost)
    }
    this.reactRoot.render(createElement(KnowledgeSvg, { code }))
    this.lastPreviewCode = code
  }

  syncSelection(view: EditorView) {
    if (this.destroyed) return
    if (view !== this.view) return
    const pos = this.getPos()
    if (pos == null) return
    const end = pos + this.node.nodeSize
    const { from, to } = view.state.selection
    const inside = from < end && to > pos
    if (inside) {
      if (!this.editing) this.enterEdit(false)
    } else {
      if (this.editing) this.showPreview()
    }
  }

  update(node: Node): boolean {
    if (node.type.name !== 'code_block') return false
    // Language left svg → force NodeView recreate (code/Shiki or mermaid).
    if (!isSvgLang(node.attrs.language as string)) return false
    this.node = node
    this.dom.dataset.language = 'svg'
    if (!this.editing) {
      if (this.lastPreviewCode !== node.textContent) {
        this.mountPreview()
      }
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
    this.enterEdit(false)
  }

  stopEvent(event: Event): boolean {
    const t = event.target as HTMLElement | null
    if (t && this.previewHost.contains(t)) return true
    return false
  }

  ignoreMutation(
    mutation: MutationRecord | { type: string; target: globalThis.Node },
  ): boolean {
    const target = mutation.target
    if (target === this.previewHost || this.previewHost.contains(target)) {
      return true
    }
    if (target === this.dom) return true
    return false
  }

  destroy() {
    this.destroyed = true
    liveSvgViews.delete(this)
    if (this.reactRoot) {
      const root = this.reactRoot
      this.reactRoot = null
      queueMicrotask(() => {
        try {
          root.unmount()
        } catch {
          // ignore
        }
      })
    }
  }
}

export { isSvgLang }
