/**
 * Live blockquote NodeView: callout chrome when first line matches [!type],
 * plain quote otherwise (R4). Always registered; branches in constructor.
 */
import type { Node } from '@milkdown/kit/prose/model'
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
} from '@milkdown/kit/prose/view'
import { blockquoteSchema } from '@milkdown/kit/preset/commonmark'
import { $view } from '@milkdown/kit/utils'
import { parseCalloutHeader } from '@/domain/knowledge/callout'
import { calloutStyleClass } from '../calloutStyles'
import i18n from '@/i18n'

function firstBlockText(node: Node): string {
  if (node.childCount === 0) return ''
  const first = node.child(0)
  return first.textContent.split('\n')[0] ?? ''
}

function detectCallout(node: Node) {
  return parseCalloutHeader(firstBlockText(node))
}

class LiveBlockquoteNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  private mode: 'callout' | 'plain'
  private typeLabel: HTMLElement | null = null

  constructor(node: Node, _view: EditorView, _getPos: () => number | undefined) {
    const header = detectCallout(node)
    this.mode = header ? 'callout' : 'plain'

    if (header) {
      this.dom = document.createElement('div')
      this.dom.className = `knowledge-live-callout my-2 rounded-md border-l-4 px-3 py-2 ${calloutStyleClass(header.type)}`
      this.dom.setAttribute('data-testid', 'knowledge-live-callout')
      this.dom.dataset.callout = header.type

      this.typeLabel = document.createElement('div')
      this.typeLabel.className =
        'mb-1 text-meta font-medium text-ink-secondary pointer-events-none'
      this.typeLabel.contentEditable = 'false'
      this.typeLabel.textContent =
        header.title ??
        i18n.t(`knowledge.callout.${header.type}`, {
          defaultValue: header.type,
        })

      this.contentDOM = document.createElement('div')
      this.contentDOM.className = 'knowledge-live-callout-body text-body text-ink'
      // Keep header line in contentDOM (editable); label is decorative summary.
      this.dom.append(this.typeLabel, this.contentDOM)
    } else {
      this.dom = document.createElement('blockquote')
      this.dom.className =
        'knowledge-live-blockquote border-l-2 border-border pl-3 text-ink-secondary my-2'
      this.contentDOM = this.dom
    }
  }

  update(node: Node): boolean {
    if (node.type.name !== 'blockquote') return false
    const header = detectCallout(node)
    const nextMode = header ? 'callout' : 'plain'
    if (nextMode !== this.mode) return false
    if (header && this.mode === 'callout') {
      this.dom.dataset.callout = header.type
      this.dom.className = `knowledge-live-callout my-2 rounded-md border-l-4 px-3 py-2 ${calloutStyleClass(header.type)}`
      if (this.typeLabel) {
        this.typeLabel.textContent =
          header.title ??
          i18n.t(`knowledge.callout.${header.type}`, {
            defaultValue: header.type,
          })
      }
    }
    return true
  }

  ignoreMutation(
    mutation: MutationRecord | { type: string; target: globalThis.Node },
  ): boolean {
    const target = mutation.target
    if (!(target instanceof globalThis.Node)) return false
    if (this.typeLabel && (target === this.typeLabel || this.typeLabel.contains(target))) {
      return true
    }
    if (target === this.contentDOM || this.contentDOM.contains(target)) {
      return false
    }
    return false
  }

  destroy() {
    this.typeLabel = null
  }
}

export const liveCalloutView = $view(
  blockquoteSchema.node,
  (): NodeViewConstructor =>
    (node, view, getPos) =>
      new LiveBlockquoteNodeView(node, view, getPos),
)

export const liveCalloutPlugins = [liveCalloutView]
