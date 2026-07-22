/**
 * Live Milkdown NodeView for ```svg code_block fences.
 *
 * Block-internal edit/preview (Notion/Feishu style):
 * - Header chrome: Source | Preview segment + copy
 * - Explicit Source/Preview pins mode so selection/copy focus cannot bounce it
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
import { kbPerfNodeViewMount } from '@/domain/knowledge/knowledgePerf'
import {
  createDiagramChrome,
  type DiagramChrome,
  type DiagramChromeMode,
} from './liveDiagramChrome'

export const liveSvgViews = new Set<LiveSvgNodeView>()

function isSvgLang(lang: string | null | undefined): boolean {
  return ((lang ?? '').trim().toLowerCase() === 'svg')
}

type ModePin = 'auto' | DiagramChromeMode

export class LiveSvgNodeView implements NodeView {
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
  private modePin: ModePin = 'auto'
  private destroyed = false
  private lastPreviewCode: string | null = null

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
      'knowledge-live-svg my-2 overflow-hidden rounded-lg border border-border bg-surface-muted/40'
    this.dom.setAttribute('data-testid', 'knowledge-live-svg')
    this.dom.dataset.language = 'svg'
    this.dom.contentEditable = 'false'
    kbPerfNodeViewMount('svg')

    this.chrome = createDiagramChrome({
      kind: 'svg',
      label: 'SVG',
      testIdPrefix: 'knowledge-live-svg',
      getSource: () => this.node.textContent,
      onMode: (mode) => {
        if (mode === 'edit') this.enterEdit({ focus: true, pin: true })
        else this.showPreview({ pin: true })
      },
      onRestoreEditAfterCopy: () => {
        if (this.destroyed) return
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

    liveSvgViews.add(this)

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
    this.editShell.setAttribute('data-testid', 'knowledge-live-svg-editing')
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

  private selectionInside(view: EditorView): boolean {
    const pos = this.getPos()
    if (pos == null) return false
    const end = pos + this.node.nodeSize
    const { from, to } = view.state.selection
    return from < end && to > pos
  }

  syncSelection(view: EditorView) {
    if (this.destroyed) return
    if (view !== this.view) return

    if (this.modePin === 'preview') {
      if (this.editing) this.applyPreviewChrome()
      return
    }
    if (this.modePin === 'edit') {
      if (!this.editing) this.applyEditChrome()
      return
    }

    const inside = this.selectionInside(view)
    if (inside) {
      if (!this.editing) this.enterEdit({ focus: false })
    } else {
      if (this.editing) this.showPreview({ pin: false })
    }
  }

  update(node: Node): boolean {
    if (node.type.name !== 'code_block') return false
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
    if (!(target instanceof Node)) return false
    if (target === this.contentDOM || this.contentDOM.contains(target)) {
      return false
    }
    // View-only chrome / editShell collapse — never let PM recreate the view.
    if (target === this.dom || this.dom.contains(target)) return true
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
