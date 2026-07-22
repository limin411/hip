/**
 * Live Milkdown NodeView for ```mermaid code_block fences.
 *
 * Block-internal edit/preview (Notion/Feishu style):
 * - Header chrome: Source | Preview segment + copy (explicit mode control)
 * - Default / auto: selection-driven (caret outside → preview, inside → edit)
 * - Explicit Source/Preview pins mode so selection/copy focus cannot bounce it
 *
 * contentDOM stays in the document (never `display:none`); collapsed out of
 * flow while previewing so a tall diagram can size the block.
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Node } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { KnowledgeMermaid } from '../KnowledgeMermaid'
import { kbPerfNodeViewMount } from '@/domain/knowledge/knowledgePerf'
import {
  createDiagramChrome,
  type DiagramChrome,
  type DiagramChromeMode,
} from './liveDiagramChrome'

export const liveMermaidViews = new Set<LiveMermaidNodeView>()

function isMermaidLang(lang: string | null | undefined): boolean {
  return ((lang ?? '').trim().toLowerCase() === 'mermaid')
}

/** Explicit chrome pin; `auto` follows selection only. */
type ModePin = 'auto' | DiagramChromeMode

export class LiveMermaidNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  private node: Node
  private view: EditorView
  private getPos: () => number | undefined
  private chrome: DiagramChrome
  private editShell: HTMLElement
  private editPre: HTMLElement
  private previewHost: HTMLElement
  private reactRoot: Root | null = null
  private editing = true
  /**
   * `preview` — stay in preview until Source / click-diagram.
   * `edit` — stay in edit until Preview (selection leave must NOT bounce).
   * `auto` — selection-driven (open doc / after deselect).
   */
  private modePin: ModePin = 'auto'
  private destroyed = false
  private lastPreviewCode: string | null = null
  private io: IntersectionObserver | null = null
  private previewPending = false

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
      'knowledge-live-mermaid my-2 overflow-hidden rounded-lg border border-border bg-surface-muted/40'
    this.dom.setAttribute('data-testid', 'knowledge-live-mermaid')
    // Chrome must not live inside contenteditable or clicks are swallowed.
    this.dom.contentEditable = 'false'
    kbPerfNodeViewMount('mermaid')
    this.dom.dataset.language = 'mermaid'

    this.chrome = createDiagramChrome({
      kind: 'mermaid',
      label: 'Mermaid',
      testIdPrefix: 'knowledge-live-mermaid',
      getSource: () => this.node.textContent,
      onMode: (mode) => {
        if (mode === 'edit') this.enterEdit({ focus: true, pin: true })
        else this.showPreview({ pin: true })
      },
      onRestoreEditAfterCopy: () => {
        if (this.destroyed) return
        // Only when chrome was Source when copy started.
        this.enterEdit({ focus: true, pin: true })
      },
    })

    const body = document.createElement('div')
    body.className = 'relative min-h-[3rem]'

    this.editShell = document.createElement('div')
    this.editShell.className = 'min-h-[3rem]'

    this.editPre = document.createElement('pre')
    this.editPre.className =
      'm-0 overflow-auto bg-transparent p-3 font-mono text-meta text-ink'
    this.contentDOM = document.createElement('code')
    this.contentDOM.spellcheck = false
    this.contentDOM.contentEditable = 'true'
    this.editPre.appendChild(this.contentDOM)
    this.editShell.appendChild(this.editPre)

    this.previewHost = document.createElement('div')
    this.previewHost.className = 'cursor-text overflow-x-auto p-2'
    this.previewHost.style.display = 'none'
    this.previewHost.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.enterEdit({ focus: true, pin: true })
    })

    body.append(this.editShell, this.previewHost)
    this.dom.append(this.chrome.header, body)

    liveMermaidViews.add(this)

    // Diagram-first when source exists. Empty fences stay in edit for typing.
    if (node.textContent.trim()) {
      this.showPreview({ pin: false })
    } else {
      this.applyEditChrome()
    }

    queueMicrotask(() => {
      if (!this.destroyed) this.syncSelection(this.view)
    })
  }

  private applyEditChrome() {
    this.editing = true
    this.dom.dataset.editing = 'true'
    this.dom.dataset.modePin = this.modePin
    this.editShell.setAttribute('data-testid', 'knowledge-live-mermaid-editing')
    this.chrome.setMode('edit')
    this.editShell.style.position = ''
    this.editShell.style.height = ''
    this.editShell.style.minHeight = ''
    this.editShell.style.overflow = ''
    this.editShell.style.opacity = ''
    this.editShell.style.pointerEvents = ''
    this.previewHost.style.display = 'none'
  }

  private applyPreviewChrome() {
    this.editing = false
    this.dom.dataset.editing = 'false'
    this.dom.dataset.modePin = this.modePin
    this.editShell.removeAttribute('data-testid')
    this.chrome.setMode('preview')
    this.editShell.style.position = 'absolute'
    this.editShell.style.height = '0'
    this.editShell.style.minHeight = '0'
    this.editShell.style.overflow = 'hidden'
    this.editShell.style.opacity = '0'
    this.editShell.style.pointerEvents = 'none'
    this.previewHost.style.display = ''
  }

  private placeSelectionInside() {
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

  private enterEdit(opts?: { focus?: boolean; pin?: boolean }) {
    if (opts?.pin) this.modePin = 'edit'
    this.applyEditChrome()
    if (opts?.focus) {
      // Defer caret placement until after chrome layout (collapsed → expanded).
      // Otherwise TextSelection can fail / land outside and auto mode bounces.
      requestAnimationFrame(() => {
        if (this.destroyed || !this.editing) return
        this.placeSelectionInside()
      })
    }
  }

  private showPreview(opts?: { pin?: boolean }) {
    if (opts?.pin) this.modePin = 'preview'
    else if (this.modePin === 'edit') this.modePin = 'auto'
    this.applyPreviewChrome()
    this.scheduleMountPreview()
  }

  private scheduleMountPreview() {
    if (this.destroyed) return
    if (typeof IntersectionObserver === 'undefined') {
      this.mountPreview()
      return
    }
    this.previewPending = true
    if (this.io) return
    let settled = false
    const finish = () => {
      if (settled || this.destroyed) return
      settled = true
      this.io?.disconnect()
      this.io = null
      if (this.previewPending && !this.editing) this.mountPreview()
    }
    this.io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) finish()
      },
      { root: null, rootMargin: '200px 0px', threshold: 0 },
    )
    this.io.observe(this.dom)
    requestAnimationFrame(() => {
      if (settled || this.destroyed) return
      const rect = this.dom.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) finish()
    })
  }

  private mountPreview() {
    if (this.destroyed) return
    this.previewPending = false
    const code = this.node.textContent
    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.previewHost)
    }
    this.reactRoot.render(createElement(KnowledgeMermaid, { code }))
    this.lastPreviewCode = code
  }

  private selectionInside(view: EditorView): boolean {
    const pos = this.getPos()
    if (pos == null) return false
    const end = pos + this.node.nodeSize
    const { from, to } = view.state.selection
    return from < end && to > pos
  }

  /**
   * Called by the shared selection plugin whenever the editor selection changes.
   */
  syncSelection(view: EditorView) {
    if (this.destroyed) return
    if (view !== this.view) return

    // Explicit chrome pins win over selection — this is the fix for
    // Preview → Copy → Source bouncing back to preview (caret still outside).
    if (this.modePin === 'preview') {
      if (this.editing) this.applyPreviewChrome()
      return
    }
    if (this.modePin === 'edit') {
      if (!this.editing) this.applyEditChrome()
      return
    }

    // auto
    const inside = this.selectionInside(view)
    if (inside) {
      if (!this.editing) this.enterEdit({ focus: false })
    } else {
      if (this.editing) this.showPreview({ pin: false })
    }
  }

  update(node: Node): boolean {
    if (node.type.name !== 'code_block') return false
    if (!isMermaidLang(node.attrs.language as string)) return false
    this.node = node
    this.dom.dataset.language = 'mermaid'
    if (!this.editing) {
      if (this.lastPreviewCode !== node.textContent) {
        this.mountPreview()
      }
    }
    return true
  }

  selectNode() {
    if (this.modePin === 'preview') return
    this.enterEdit({ focus: false, pin: this.modePin === 'edit' })
  }

  deselectNode() {
    this.modePin = 'auto'
    this.showPreview({ pin: false })
  }

  setSelection() {
    if (this.modePin === 'preview') return
    this.enterEdit({ focus: false, pin: this.modePin === 'edit' })
  }

  stopEvent(event: Event): boolean {
    const t = event.target as HTMLElement | null
    if (t && this.chrome.contains(t)) return true
    if (t && this.previewHost.contains(t)) return true
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
    // Chrome, preview host, and editShell show/hide styles are view-only.
    // If PM sees those mutations it destroys+recreates the NodeView and we
    // lose modePin — which looks like Source→Preview bounce after copy.
    if (target === this.dom || this.dom.contains(target)) return true
    return false
  }

  destroy() {
    this.destroyed = true
    this.previewPending = false
    this.io?.disconnect()
    this.io = null
    liveMermaidViews.delete(this)
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

export { isMermaidLang }
